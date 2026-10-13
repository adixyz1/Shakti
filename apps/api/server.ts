import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import { WebSocketServer, WebSocket } from 'ws';
import {
  assertValidDemoModeConfiguration,
  assertValidProductionConfiguration,
  config,
} from './src/core/config';
import { initDatabase } from './src/core/db';
import {
  csrfProtectionMiddleware,
  securityHeadersMiddleware,
} from './src/core/middleware';
import { seedDatabase } from './src/core/seed';
import { logger } from './src/core/security';
import { apiRouter } from './src/routes/auth';
import { consentsRouter } from './src/routes/consents';
import { contactsRouter } from './src/routes/contacts';
import { demoRouter } from './src/routes/demo';
import { incidentsRouter } from './src/routes/incidents';
import { journeysRouter } from './src/routes/journeys';
import { metricsRouter } from './src/routes/metrics';
import { reportsRouter } from './src/routes/reports';
import { resourcesPulseRouter } from './src/routes/resourcesPulse';
import { responderRouter } from './src/routes/responder';
import { startRetentionPurgeSchedule } from './src/services/retentionService';
import {
  recoverActiveJourneysOnStartup,
  recoverPendingIncidentsOnStartup,
} from './src/services/scheduler';
import { attachWebSocketHub } from './src/services/wsHub';

export function createApp(): Express {
  const app = express();

  app.use(securityHeadersMiddleware);
  app.use(express.json({ limit: '64kb' }));
  app.use(cookieParser());
  app.use(csrfProtectionMiddleware);

  // Mount API routes under /api (primary prefix) and root for direct health/auth calls
  app.use('/api', apiRouter);
  app.use('/api', consentsRouter);
  app.use('/api', contactsRouter);
  app.use('/api', demoRouter);
  app.use('/api', incidentsRouter);
  app.use('/api', journeysRouter);
  app.use('/api', metricsRouter);
  app.use('/api', reportsRouter);
  app.use('/api', resourcesPulseRouter);
  app.use('/api', responderRouter);
  app.use('/', apiRouter);
  app.use('/', consentsRouter);
  app.use('/', contactsRouter);
  app.use('/', demoRouter);
  app.use('/', incidentsRouter);
  app.use('/', journeysRouter);
  app.use('/', metricsRouter);
  app.use('/', reportsRouter);
  app.use('/', resourcesPulseRouter);
  app.use('/', responderRouter);

  return app;
}

export function attachWebSocketServer(server: http.Server): WebSocketServer {
  return attachWebSocketHub(server);
}

let isServerStarted = false;

export async function startServer(
  env: NodeJS.ProcessEnv = process.env
): Promise<http.Server> {
  // Refuse to start if production safeguards fail (including DEMO_MODE=true in production, missing/default secrets, or mock OTP without ALLOW_MOCK_PROVIDERS=true)
  assertValidProductionConfiguration(env);

  if (isServerStarted) {
    throw new Error('Server is already running');
  }
  isServerStarted = true;

  const db = await initDatabase();
  await seedDatabase(db, env);
  await recoverPendingIncidentsOnStartup(db);
  await recoverActiveJourneysOnStartup(db);
  startRetentionPurgeSchedule(db);

  const app = createApp();
  const server = http.createServer(app);

  attachWebSocketServer(server);

  if (
    process.env.NODE_ENV !== 'production' &&
    process.env.SERVE_STATIC !== 'true'
  ) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return new Promise((resolve) => {
    server.listen(config.port, '0.0.0.0', () => {
      logger.info(
        `[SAATHI Server] Single-process Express + WS + Vite listening on http://0.0.0.0:${config.port}`
      );
      resolve(server);
    });
  });
}

const currentFilePath = fileURLToPath(import.meta.url);
if (
  process.env.VITEST !== 'true' &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(currentFilePath)
) {
  startServer().catch((err) => {
    console.error('Failed to start SAATHI server:', err);
    process.exit(1);
  });
}
