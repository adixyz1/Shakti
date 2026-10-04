import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from './src/core/config';
import { initDatabase } from './src/core/db';
import { securityHeadersMiddleware } from './src/core/middleware';
import { seedDatabase } from './src/core/seed';
import { logger } from './src/core/security';
import { apiRouter } from './src/routes/auth';
import { consentsRouter } from './src/routes/consents';
import { contactsRouter } from './src/routes/contacts';
import { incidentsRouter } from './src/routes/incidents';
import { startRetentionPurgeSchedule } from './src/services/retentionService';
import { recoverPendingIncidentsOnStartup } from './src/services/scheduler';
import { attachWebSocketHub } from './src/services/wsHub';

export function createApp(): Express {
  const app = express();

  app.use(securityHeadersMiddleware);
  app.use(express.json());
  app.use(cookieParser());

  // Mount API routes under /api (primary prefix) and root for direct health/auth calls
  app.use('/api', apiRouter);
  app.use('/api', consentsRouter);
  app.use('/api', contactsRouter);
  app.use('/api', incidentsRouter);
  app.use('/', apiRouter);
  app.use('/', consentsRouter);
  app.use('/', contactsRouter);
  app.use('/', incidentsRouter);

  return app;
}

export function attachWebSocketServer(server: http.Server): WebSocketServer {
  return attachWebSocketHub(server);
}

let isServerStarted = false;

export async function startServer(): Promise<http.Server> {
  if (isServerStarted) {
    throw new Error('Server is already running');
  }
  isServerStarted = true;

  const db = await initDatabase();
  await seedDatabase(db);
  await recoverPendingIncidentsOnStartup(db);
  startRetentionPurgeSchedule(db);

  const app = createApp();
  const server = http.createServer(app);

  attachWebSocketServer(server);

  if (process.env.NODE_ENV !== 'production') {
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
