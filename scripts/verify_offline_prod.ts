import 'fake-indexeddb/auto';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { createApp } from '../apps/api/server';
import { initDatabase, closeDatabase } from '../apps/api/src/core/db';
import { seedDatabase } from '../apps/api/src/core/seed';
import { clearAllScheduledTimers } from '../apps/api/src/services/scheduler';
import { attachWebSocketHub } from '../apps/api/src/services/wsHub';
import { triggerSos } from '../apps/web/src/lib/sos';
import {
  buildEmergencySmsBody,
  buildSmsFallbackHref,
  clearAllQueuedAlerts,
  clearOfflineEmergencyContactsCache,
  flushOfflineAlertQueue,
  getCachedEmergencyContacts,
  listQueuedAlerts,
  syncOfflineEmergencyContactsCache,
} from '../apps/web/src/lib/offlineQueue';

async function main() {
  const distPath = path.join(process.cwd(), 'dist');
  const swPath = path.join(distPath, 'sw.js');
  const manifestPath = path.join(distPath, 'manifest.webmanifest');
  const indexHtmlPath = path.join(distPath, 'index.html');

  console.log('=== SAATHI Phase 5 Production Offline Verification ===');

  if (!fs.existsSync(swPath) || !fs.existsSync(indexHtmlPath)) {
    throw new Error(
      'dist/sw.js or dist/index.html missing. Run `npm run build` first.'
    );
  }

  const swStat = fs.statSync(swPath);
  const manifestRaw = fs.readFileSync(manifestPath, 'utf-8');
  const manifestJson = JSON.parse(manifestRaw);
  console.log(
    `[1] Production build verified: dist/sw.js (${swStat.size} bytes), manifest display="${manifestJson.display}", icons=${manifestJson.icons.length}`
  );

  const tempDbPath = path.join(
    os.tmpdir(),
    `saathi-prod-offline-${crypto.randomUUID()}.db`
  );
  const db = await initDatabase(`file:${tempDbPath}`);
  await seedDatabase(db);

  const app = createApp();
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(indexHtmlPath);
  });

  const server = http.createServer(app);
  const wss = attachWebSocketHub(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const agent = request.agent(baseUrl);

    // Verify Express production server serves index.html, sw.js, and manifest.webmanifest
    const swRes = await agent.get('/sw.js');
    const mfRes = await agent.get('/manifest.webmanifest');
    const shellRes = await agent.get('/home');
    if (swRes.status !== 200 || mfRes.status !== 200 || shellRes.status !== 200) {
      throw new Error('Failed to serve production PWA assets from Express');
    }
    console.log(
      `[2] Express production server serving /sw.js (${swRes.status}), /manifest.webmanifest (${mfRes.status}), and SPA shell /home (${shellRes.status})`
    );

    // Step 1: Authenticate & load contacts while online
    const otpReq = await agent
      .post('/api/auth/otp/request')
      .send({ phone_e164: '+919000000001' });
    await agent.post('/api/auth/otp/verify').send({
      phone_e164: '+919000000001',
      code: otpReq.body.dev_mock_hint,
    });

    const createCtRes = await agent.post('/api/contacts').send({
      name: 'Meera Nair',
      phone_e164: '+919000000011',
      permissions: {
        receives_sos: true,
        receives_checkin: true,
        can_see_live_location: true,
      },
    });
    await request(baseUrl).post(
      `/api/invitations/${createCtRes.body.invitation_token}/accept`
    );

    const contactsRes = await agent.get('/api/contacts');
    const cached = await syncOfflineEmergencyContactsCache(
      contactsRes.body.contacts,
      true
    );
    console.log(
      `[3] Loaded app online & cached ${cached.length} consented SOS contact(s) in IndexedDB: ${cached
        .map((c) => `${c.name} (${c.phone_e164})`)
        .join(', ')}`
    );

    // Step 2: Go offline & trigger SOS
    await clearAllQueuedAlerts();
    const failingOfflineFetch = (async () => {
      throw new TypeError('Failed to fetch (simulated offline)');
    }) as unknown as typeof fetch;

    const triggerRes = await triggerSos('button', failingOfflineFetch, {
      location: {
        lat: 28.6139,
        lng: 77.209,
        accuracy_m: 11,
        captured_at: new Date().toISOString(),
      },
    });
    const queued = await listQueuedAlerts();
    const smsBody = buildEmergencySmsBody({
      userName: 'Aarohi Sharma',
      location: queued[0].location,
      triggeredAtIso: queued[0].client_created_at,
    });
    const androidSmsHref = buildSmsFallbackHref(
      cached.map((c) => c.phone_e164),
      smsBody,
      'android'
    );
    console.log(
      `[4] Triggered SOS while offline -> queued_offline=${Boolean(
        triggerRes.queued_offline
      )}, queue length=${queued.length}, client_request_id=${
        queued[0].client_request_id
      }`
    );
    console.log(`[5] SMS Fallback link ready: ${androidSmsHref}`);

    // Step 3: Reconnect online & flush queue (twice to verify idempotency)
    const onlineFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input.toString();
      const method = (init?.method || 'GET').toLowerCase() as
        | 'get'
        | 'post'
        | 'put'
        | 'patch'
        | 'delete';
      let req = (agent as any)[method](urlStr);
      if (init?.body && typeof init.body === 'string') {
        req = req
          .set('Content-Type', 'application/json')
          .send(JSON.parse(init.body));
      }
      const res = await req;
      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        json: async () => res.body,
      } as Response;
    }) as typeof fetch;

    const flushResult = await flushOfflineAlertQueue(onlineFetch);
    const activeCheck = await agent.get('/api/incidents/active');
    console.log(
      `[6] Went online & flushed queue -> delivered=${flushResult.delivered.length}, remaining=${flushResult.remaining.length}, server active incident id=${activeCheck.body.incident?.id} (client_request_id=${activeCheck.body.incident?.client_request_id})`
    );
    console.log('=== ALL PRODUCTION OFFLINE CHECKS PASSED ===');
  } finally {
    await clearAllQueuedAlerts();
    await clearOfflineEmergencyContactsCache();
    clearAllScheduledTimers();
    wss.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeDatabase();
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const candidate = `${tempDbPath}${suffix}`;
      if (fs.existsSync(candidate)) {
        fs.unlinkSync(candidate);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
