import fs from 'fs';
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
import { safetyToolsRouter } from './src/routes/safetyTools';
import { startRetentionPurgeSchedule } from './src/services/retentionService';
import {
  recoverActiveJourneysOnStartup,
  recoverPendingIncidentsOnStartup,
} from './src/services/scheduler';
import { attachWebSocketHub } from './src/services/wsHub';

function resolveLocalApkPath(): string | null {
  const candidates = [
    path.join(process.cwd(), 'public', 'shakti.apk'),
    path.join(process.cwd(), 'public', 'saathi.apk'),
    path.join(process.cwd(), 'dist', 'shakti.apk'),
    path.join(process.cwd(), 'dist', 'saathi.apk'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

export function createApp(): Express {
  const app = express();

  const trustProxyEnv = (process.env.TRUST_PROXY || '').trim();
  if (trustProxyEnv === '1' || trustProxyEnv.toLowerCase() === 'true') {
    app.set('trust proxy', 1);
  } else if (trustProxyEnv) {
    const num = Number(trustProxyEnv);
    app.set('trust proxy', isNaN(num) ? trustProxyEnv : num);
  }

  app.use(securityHeadersMiddleware);
  app.use(express.json({ limit: '64kb' }));
  app.use(cookieParser());
  app.use(csrfProtectionMiddleware);

  // Android TWA Digital Asset Links (/.well-known/assetlinks.json)
  app.get('/.well-known/assetlinks.json', (_req, res) => {
    const pkgName =
      (process.env.ANDROID_TWA_PACKAGE_NAME || '').trim() ||
      'app.shakti.safety.twa';
    const fingerprint = (
      process.env.ANDROID_TWA_SHA256_FINGERPRINT || ''
    ).trim();
    if (fingerprint) {
      res.setHeader('Content-Type', 'application/json');
      res.status(200).json([
        {
          relation: ['delegate_permission/common.handle_all_urls'],
          target: {
            namespace: 'android_app',
            package_name: pkgName,
            sha256_cert_fingerprints: [fingerprint],
          },
        },
      ]);
      return;
    }
    const staticAssetLinks = path.join(
      process.cwd(),
      'public',
      '.well-known',
      'assetlinks.json'
    );
    if (fs.existsSync(staticAssetLinks)) {
      res.setHeader('Content-Type', 'application/json');
      res.sendFile(staticAssetLinks);
      return;
    }
    res.status(200).json([]);
  });

  // Check if a packaged Android .apk is available for direct download
  app.get(['/api/apk-status', '/apk-status'], (_req, res) => {
    const externalUrl = (process.env.VITE_ANDROID_APK_URL || '').trim();
    const localApk = resolveLocalApkPath();
    const isExternalHttp = /^https?:\/\//i.test(externalUrl);
    const available = Boolean(localApk || isExternalHttp);
    res.status(200).json({
      available,
      downloadUrl: isExternalHttp ? externalUrl : '/shakti.apk',
      filename: 'shakti-android.apk',
    });
  });

  // Direct Android .apk file download endpoint
  app.get(
    ['/shakti.apk', '/saathi.apk', '/api/download/apk'],
    (_req, res) => {
      const localApk = resolveLocalApkPath();
      if (!localApk) {
        res.status(404).json({
          error: {
            code: 'APK_NOT_UPLOADED',
            message:
              'Android APK package has not been placed in public/shakti.apk yet. Generate it via PWABuilder and place shakti.apk in the public/ directory.',
          },
        });
        return;
      }
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="shakti-android.apk"'
      );
      res.sendFile(localApk);
    }
  );

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
  app.use('/api', safetyToolsRouter);
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
  app.use('/', safetyToolsRouter);

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

  const isDev = process.env.NODE_ENV !== 'production';
  const listenPort = Number(
    (isDev && process.env.PORT === '8080' ? 3000 : process.env.PORT) ||
      config.port ||
      3000
  );
  return new Promise((resolve) => {
    server.listen(listenPort, '0.0.0.0', () => {
      logger.info(
        `[SAATHI Server] Single-process Express + WS + Vite listening on http://0.0.0.0:${listenPort}`
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
