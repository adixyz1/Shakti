import { defaultOtpProvider } from '../providers/otp';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { WebSocket as NodeWebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../server';
import {
  assertValidProductionConfiguration,
  config,
  DEFAULT_DEV_JWT_SECRET,
} from '../core/config';
import { getDb, initDatabase, type AppDatabase } from '../core/db';
import { resetRateLimiter } from '../core/middleware';
import { seedDatabase } from '../core/seed';
import {
  consents,
  contactIncidentTokens,
  incidents,
  responders,
  users,
} from '../db/schema';
import { clearAllScheduledTimers } from '../services/scheduler';
import { transition } from '../services/incidentStateMachine';
import { dispatchInitialActiveNotifications } from '../services/notificationDispatcher';
import { attachWebSocketHub } from '../services/wsHub';
import { eq } from 'drizzle-orm';

const testDbPath = path.join(
  os.tmpdir(),
  `saathi-phase9a-security-${Date.now()}-${Math.random().toString(16).slice(2)}.db`
);

type AccessClass =
  | 'public'
  | 'any_user'
  | 'owner_only'
  | 'contact_token'
  | 'responder'
  | 'admin';

interface RouteAuthSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  accessClass: AccessClass;
}

/**
 * Authoritative table of EVERY registered route in the SAATHI backend.
 * If any route is added to Express without being listed here, the enumeration test fails.
 */
export const REGISTERED_ROUTE_ACCESS_TABLE: RouteAuthSpec[] = [
  // Auth & Profile (apiRouter)
  { method: 'GET', path: '/health', accessClass: 'public' },
  { method: 'POST', path: '/auth/otp/request', accessClass: 'public' },
  { method: 'POST', path: '/auth/otp/verify', accessClass: 'public' },
  { method: 'POST', path: '/auth/refresh', accessClass: 'public' },
  { method: 'POST', path: '/auth/logout', accessClass: 'public' },
  { method: 'GET', path: '/me', accessClass: 'any_user' },
  { method: 'PATCH', path: '/me', accessClass: 'any_user' },
  { method: 'GET', path: '/me/export', accessClass: 'any_user' },
  { method: 'DELETE', path: '/me', accessClass: 'owner_only' },
  { method: 'GET', path: '/rbac/admin-check', accessClass: 'admin' },
  { method: 'GET', path: '/rbac/responder-check', accessClass: 'responder' },

  // Consents (consentsRouter)
  { method: 'GET', path: '/consents', accessClass: 'any_user' },
  { method: 'POST', path: '/consents', accessClass: 'any_user' },

  // Contacts, Invitations & Public Contact Magic Links (contactsRouter)
  { method: 'GET', path: '/contacts', accessClass: 'any_user' },
  { method: 'POST', path: '/contacts', accessClass: 'any_user' },
  { method: 'POST', path: '/contacts/reorder', accessClass: 'owner_only' },
  { method: 'PATCH', path: '/contacts/:id', accessClass: 'owner_only' },
  { method: 'POST', path: '/contacts/:id/pause', accessClass: 'owner_only' },
  { method: 'POST', path: '/contacts/:id/resume', accessClass: 'owner_only' },
  { method: 'DELETE', path: '/contacts/:id', accessClass: 'owner_only' },
  { method: 'POST', path: '/contacts/:id/remove', accessClass: 'owner_only' },
  { method: 'GET', path: '/invitations/:token', accessClass: 'contact_token' },
  {
    method: 'POST',
    path: '/invitations/:token/accept',
    accessClass: 'contact_token',
  },
  {
    method: 'POST',
    path: '/invitations/:token/decline',
    accessClass: 'contact_token',
  },
  { method: 'GET', path: '/c/:token', accessClass: 'contact_token' },
  { method: 'POST', path: '/c/:token/respond', accessClass: 'contact_token' },
  { method: 'GET', path: '/dev/outbox', accessClass: 'public' },

  // Demo Mode & Test-Only Hooks (demoRouter)
  { method: 'GET', path: '/demo/status', accessClass: 'public' },
  { method: 'POST', path: '/demo/reset', accessClass: 'admin' },
  {
    method: 'POST',
    path: '/demo/simulate/responder',
    accessClass: 'owner_only',
  },
  { method: 'POST', path: '/demo/simulate/contact', accessClass: 'owner_only' },
  { method: 'POST', path: '/test/retention/purge', accessClass: 'public' },
  { method: 'POST', path: '/test/providers/failure', accessClass: 'public' },
  { method: 'POST', path: '/test/ratelimit/reset', accessClass: 'public' },

  // Incidents & Safety PIN Settings (incidentsRouter)
  { method: 'POST', path: '/incidents', accessClass: 'any_user' },
  { method: 'GET', path: '/incidents/active', accessClass: 'any_user' },
  { method: 'GET', path: '/incidents/:id', accessClass: 'owner_only' },
  { method: 'POST', path: '/incidents/:id/cancel', accessClass: 'owner_only' },
  {
    method: 'POST',
    path: '/incidents/:id/location',
    accessClass: 'owner_only',
  },
  { method: 'POST', path: '/incidents/:id/type', accessClass: 'owner_only' },
  { method: 'POST', path: '/incidents/:id/resolve', accessClass: 'owner_only' },
  { method: 'POST', path: '/incidents/:id/rating', accessClass: 'owner_only' },
  { method: 'PUT', path: '/settings/cancel-window', accessClass: 'any_user' },
  { method: 'PUT', path: '/settings/cancel-pin', accessClass: 'any_user' },
  { method: 'PUT', path: '/settings/duress-pin', accessClass: 'any_user' },

  // Safe Journeys (journeysRouter)
  { method: 'GET', path: '/journeys/active', accessClass: 'any_user' },
  { method: 'POST', path: '/journeys', accessClass: 'any_user' },
  { method: 'POST', path: '/journeys/start', accessClass: 'any_user' },
  { method: 'GET', path: '/journeys/:id', accessClass: 'owner_only' },
  { method: 'POST', path: '/journeys/:id/extend', accessClass: 'owner_only' },
  { method: 'POST', path: '/journeys/:id/complete', accessClass: 'owner_only' },
  { method: 'POST', path: '/journeys/:id/cancel', accessClass: 'owner_only' },

  // Admin Impact Metrics (metricsRouter)
  { method: 'GET', path: '/admin/metrics', accessClass: 'admin' },
  { method: 'GET', path: '/admin/metrics.csv', accessClass: 'admin' },

  // Community Safety Reports & Layer (reportsRouter)
  { method: 'POST', path: '/reports', accessClass: 'public' },
  { method: 'GET', path: '/reports', accessClass: 'admin' },
  { method: 'GET', path: '/safety-layer', accessClass: 'public' },
  { method: 'GET', path: '/admin/reports', accessClass: 'admin' },
  { method: 'DELETE', path: '/admin/reports/:id', accessClass: 'admin' },

  // Resources Directory & Weekly Safety Pulse (resourcesPulseRouter)
  { method: 'GET', path: '/resources', accessClass: 'public' },
  { method: 'POST', path: '/admin/resources', accessClass: 'admin' },
  { method: 'POST', path: '/resources', accessClass: 'admin' },
  { method: 'PUT', path: '/admin/resources/:id', accessClass: 'admin' },
  { method: 'PUT', path: '/resources/:id', accessClass: 'admin' },
  { method: 'DELETE', path: '/admin/resources/:id', accessClass: 'admin' },
  { method: 'DELETE', path: '/resources/:id', accessClass: 'admin' },
  { method: 'GET', path: '/pulse/status', accessClass: 'public' },
  { method: 'POST', path: '/pulse', accessClass: 'public' },

  // Safety Tools Guide (safetyToolsRouter)
  { method: 'GET', path: '/safety-tools', accessClass: 'public' },
  { method: 'POST', path: '/admin/safety-tools', accessClass: 'admin' },
  { method: 'POST', path: '/safety-tools', accessClass: 'admin' },
  { method: 'PUT', path: '/admin/safety-tools/:id', accessClass: 'admin' },
  { method: 'PUT', path: '/safety-tools/:id', accessClass: 'admin' },
  { method: 'DELETE', path: '/admin/safety-tools/:id', accessClass: 'admin' },
  { method: 'DELETE', path: '/safety-tools/:id', accessClass: 'admin' },

  // Responder Dashboard & Admin Responder/Audit Management (responderRouter)
  { method: 'GET', path: '/responder/incidents', accessClass: 'responder' },
  { method: 'GET', path: '/responder/incidents/:id', accessClass: 'responder' },
  {
    method: 'POST',
    path: '/responder/incidents/:id/acknowledge',
    accessClass: 'responder',
  },
  {
    method: 'POST',
    path: '/responder/incidents/:id/assign',
    accessClass: 'responder',
  },
  {
    method: 'POST',
    path: '/responder/incidents/:id/note',
    accessClass: 'responder',
  },
  {
    method: 'POST',
    path: '/responder/incidents/:id/responding',
    accessClass: 'responder',
  },
  {
    method: 'POST',
    path: '/responder/incidents/:id/resolve',
    accessClass: 'responder',
  },
  {
    method: 'POST',
    path: '/responder/incidents/:id/false-alarm',
    accessClass: 'responder',
  },
  { method: 'GET', path: '/admin/audit-log', accessClass: 'admin' },
  { method: 'GET', path: '/admin/audit-logs', accessClass: 'admin' },
  { method: 'GET', path: '/admin/responders', accessClass: 'admin' },
  { method: 'PATCH', path: '/admin/responders/:id', accessClass: 'admin' },
];

function extractExpressRoutes(
  app: Express
): Array<{ method: string; path: string }> {
  const discovered = new Map<string, { method: string; path: string }>();
  const routerStack = (app as unknown as { _router?: { stack?: unknown[] } })
    ._router?.stack;

  function normalizeMountPrefix(regexp: RegExp | undefined): string {
    if (!regexp) return '';
    const src = regexp.source;
    if (src.includes('\\/api')) return '/api';
    return '';
  }

  function walkStack(stack: unknown[], prefix: string) {
    for (const layer of stack as Array<{
      route?: { path: string | string[]; methods: Record<string, boolean> };
      name?: string;
      handle?: { stack?: unknown[] };
      regexp?: RegExp;
    }>) {
      if (layer.route) {
        const paths = Array.isArray(layer.route.path)
          ? layer.route.path
          : [layer.route.path];
        const methods = Object.keys(layer.route.methods)
          .filter((m) => layer.route!.methods[m])
          .map((m) => m.toUpperCase());

        for (const p of paths) {
          // Normalize to canonical route path (strip leading /api if mounted at both /api and /)
          const rawFull = `${prefix}${p}`.replace(/\/+/g, '/');
          const canonicalPath = rawFull.startsWith('/api/')
            ? rawFull.slice(4)
            : rawFull;
          for (const method of methods) {
            const key = `${method} ${canonicalPath}`;
            discovered.set(key, { method, path: canonicalPath });
          }
        }
      } else if (layer.name === 'router' && layer.handle?.stack) {
        const subPrefix = normalizeMountPrefix(layer.regexp);
        walkStack(layer.handle.stack, `${prefix}${subPrefix}`);
      }
    }
  }

  if (routerStack) {
    walkStack(routerStack, '');
  }
  return Array.from(discovered.values());
}

describe('Phase 9A: Security Hardening (Safeguards, Auth Sweep, CSRF, Headers/Limits, Validation, Log PII Scan)', () => {
  let db: AppDatabase;
  let app: Express;
  let ownerAgent: ReturnType<typeof request.agent>;
  let secondUserAgent: ReturnType<typeof request.agent>;
  let responderAgent: ReturnType<typeof request.agent>;
  let adminAgent: ReturnType<typeof request.agent>;

  let ownerToken = '';
  let secondUserToken = '';
  let responderToken = '';
  let adminToken = '';

  let ownerUserId = '';
  let responderUserId = '';
  let responderRowId = '';
  let ownerContactId = '';
  let ownerIncidentId = '';
  let ownerJourneyId = '';
  let reportId = '';
  let resourceId = 'res_112_erss';
  let safetyToolId = 'tool_whistle';
  let invitationToken = '';
  let contactMagicToken = '';
  let seededUsersInProdCount = -1;

  async function signInAgent(phone: string, name: string) {
    resetRateLimiter();
    const agent = request.agent(app);
    agent.set('Origin', 'http://localhost:3000');
    const reqRes = await agent
      .post('/api/auth/otp/request')
      .send({ phone_e164: phone });
    expect(reqRes.status).toBe(200);
    const code = reqRes.body.dev_mock_hint || (defaultOtpProvider as any).lastOtpCode || '123456';
    const verRes = await agent
      .post('/api/auth/otp/verify')
      .send({ phone_e164: phone, code, name });
    expect(verRes.status).toBe(200);
    const cookies = (verRes.headers['set-cookie'] as unknown as string[]) || [];
    const accessCookie = cookies.find((c) =>
      c.startsWith('saathi_access_token=')
    );
    const rawAccessToken = accessCookie
      ? accessCookie.split(';')[0].split('=')[1]
      : '';
    return { agent, user: verRes.body, accessToken: rawAccessToken };
  }

  beforeAll(async () => {
    delete process.env.DEMO_MODE;
    process.env.NODE_ENV = 'test';

    // First verify that seedDatabase in NODE_ENV=production does not create demo/admin/responder accounts
    const prodDbPath = path.join(
      os.tmpdir(),
      `saathi-prod-seed-${Date.now()}.db`
    );
    const prodDb = await initDatabase(`file:${prodDbPath}`);
    await seedDatabase(prodDb, { NODE_ENV: 'production' });
    const seededInProd = await prodDb.select().from(users);
    seededUsersInProdCount = seededInProd.length;
    try {
      if (fs.existsSync(prodDbPath)) fs.unlinkSync(prodDbPath);
    } catch {
      // ignore
    }

    db = await initDatabase(`file:${testDbPath}`);
    await seedDatabase(db);
    app = createApp();

    const ownerAuth = await signInAgent('+919000000001', 'Aarohi Sharma');
    ownerAgent = ownerAuth.agent;
    ownerUserId = ownerAuth.user.id;
    ownerToken = ownerAuth.accessToken;

    const secondAuth = await signInAgent('+919000000099', 'Other User');
    secondUserAgent = secondAuth.agent;
    secondUserToken = secondAuth.accessToken;

    const respAuth = await signInAgent('+919000000002', 'Inspector Kavita Rao');
    responderAgent = respAuth.agent;
    responderUserId = respAuth.user.id;
    responderToken = respAuth.accessToken;

    const adminAuth = await signInAgent('+919000000003', 'Meera Nair');
    adminAgent = adminAuth.agent;
    adminToken = adminAuth.accessToken;

    const [respRow] = await db
      .select()
      .from(responders)
      .where(eq(responders.userId, responderUserId))
      .limit(1);
    responderRowId = respRow.id;

    // Grant location + data_processing consents for owner
    await ownerAgent
      .post('/api/consents')
      .send({ type: 'data_processing', granted: true });
    await ownerAgent
      .post('/api/consents')
      .send({ type: 'location', granted: true });

    // Create a contact & capture invitation token
    const contactRes = await ownerAgent.post('/api/contacts').send({
      name: 'Priya Sister',
      phone_e164: '+919811122233',
      permissions: {
        receives_sos: true,
        receives_checkin: true,
        can_see_live_location: true,
      },
    });
    expect(contactRes.status).toBe(201);
    ownerContactId = contactRes.body.contact.id;
    invitationToken = contactRes.body.invitation_token;

    // Accept invitation so SOS dispatches magic token
    await request(app).post(`/api/invitations/${invitationToken}/accept`);

    // Create an incident for owner & activate it so responder and contact have access
    const incRes = await ownerAgent.post('/api/incidents').send({
      client_request_id: 'phase9a_inc_1',
      source_trigger: 'button',
      location: { lat: 28.6139, lng: 77.209, accuracy_m: 10 },
    });
    expect(incRes.status).toBe(201);
    ownerIncidentId = incRes.body.incident.id;

    await transition(
      ownerIncidentId,
      'ACTIVE',
      { type: 'system', id: 'cancel_window_timer' },
      'Activated after cancel window',
      db
    );
    await dispatchInitialActiveNotifications(ownerIncidentId, db);

    // Create a fresh unaccepted contact for invitation accept/decline sweep
    const inv2Res = await ownerAgent.post('/api/contacts').send({
      name: 'Meena Friend',
      phone_e164: '+919811122244',
      permissions: {
        receives_sos: true,
        receives_checkin: true,
        can_see_live_location: false,
      },
    });
    invitationToken = inv2Res.body.invitation_token;

    // Start a journey for owner
    const jRes = await ownerAgent.post('/api/journeys').send({
      duration_minutes: 30,
      note: 'Walking home',
    });
    expect(jRes.status).toBe(201);
    ownerJourneyId = jRes.body.journey.id;

    // Create a safety report
    const repRes = await ownerAgent.post('/api/reports').send({
      category: 'poor_lighting',
      lat: 28.6139,
      lng: 77.209,
      note: 'Streetlight broken',
      anonymous: true,
    });
    expect(repRes.status).toBe(201);
    reportId = repRes.body.report.id;

    // Retrieve the contact magic-link token from dev outbox
    const outboxRes = await request(app).get('/api/dev/outbox');
    const sosMsg = (
      outboxRes.body.messages as Array<{
        purpose: string;
        metadata?: { incident_id?: string; token?: string };
      }>
    ).find(
      (m) =>
        m.purpose === 'sos_alert' &&
        m.metadata?.incident_id === ownerIncidentId &&
        typeof m.metadata?.token === 'string'
    );
    expect(sosMsg).toBeDefined();
    contactMagicToken = sosMsg!.metadata!.token!;
  });

  afterAll(() => {
    delete process.env.DEMO_MODE;
    process.env.NODE_ENV = 'test';
    clearAllScheduledTimers();
    resetRateLimiter();
    try {
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
      if (fs.existsSync(`${testDbPath}-wal`))
        fs.unlinkSync(`${testDbPath}-wal`);
      if (fs.existsSync(`${testDbPath}-shm`))
        fs.unlinkSync(`${testDbPath}-shm`);
    } catch {
      // ignore cleanup errors
    }
  });

  it('1. Production safeguards: refuses to start with missing/default JWT/HMAC secrets, active MockOtpProvider without ALLOW_MOCK_PROVIDERS=true, or DEMO_MODE=true; skips seeding demo accounts in production; dev outbox returns 404; cookies are HttpOnly, SameSite=Lax, Secure in production', async () => {
    // 1a. Missing JWT_SECRET_KEY in production
    expect(() =>
      assertValidProductionConfiguration({
        NODE_ENV: 'production',
        JWT_SECRET_KEY: '',
        ALLOW_MOCK_PROVIDERS: 'true',
      })
    ).toThrow(/JWT_SECRET_KEY/i);

    // 1b. Default dev JWT_SECRET_KEY in production
    expect(() =>
      assertValidProductionConfiguration({
        NODE_ENV: 'production',
        JWT_SECRET_KEY: DEFAULT_DEV_JWT_SECRET,
        ALLOW_MOCK_PROVIDERS: 'true',
      })
    ).toThrow(/JWT_SECRET_KEY/i);

    // 1c. Default/weak HMAC_SECRET_KEY in production
    expect(() =>
      assertValidProductionConfiguration({
        NODE_ENV: 'production',
        JWT_SECRET_KEY: 'prod-strong-secret-key-at-least-32-chars!!',
        HMAC_SECRET_KEY: 'short-hmac-secret',
        ALLOW_MOCK_PROVIDERS: 'true',
      })
    ).toThrow(/HMAC_SECRET_KEY/i);

    // 1d. Mock OTP provider active without ALLOW_MOCK_PROVIDERS=true in production
    expect(() =>
      assertValidProductionConfiguration({
        NODE_ENV: 'production',
        JWT_SECRET_KEY: 'prod-strong-secret-key-at-least-32-chars!!',
      })
    ).toThrow(/MockOtpProvider|ALLOW_MOCK_PROVIDERS/i);

    // 1e. DEMO_MODE=true in production is refused even if secrets and ALLOW_MOCK_PROVIDERS are set
    expect(() =>
      assertValidProductionConfiguration({
        NODE_ENV: 'production',
        DEMO_MODE: 'true',
        JWT_SECRET_KEY: 'prod-strong-secret-key-at-least-32-chars!!',
        ALLOW_MOCK_PROVIDERS: 'true',
      })
    ).toThrow(/DEMO_MODE=true is forbidden when NODE_ENV=production/i);

    // 1f. Valid production config with strong secret and explicit ALLOW_MOCK_PROVIDERS=true passes
    expect(() =>
      assertValidProductionConfiguration({
        NODE_ENV: 'production',
        JWT_SECRET_KEY: 'prod-strong-secret-key-at-least-32-chars!!',
        ALLOW_MOCK_PROVIDERS: 'true',
      })
    ).not.toThrow();

    // 1g. In production (with DEMO_MODE off), seedDatabase does NOT create demo/admin/responder accounts
    expect(seededUsersInProdCount).toBe(0);

    // 1h. Dev outbox returns 404 and auth cookies have HttpOnly, SameSite=Lax, and Secure when NODE_ENV=production
    resetRateLimiter();
    const otpReqForProd = await request(app)
      .post('/api/auth/otp/request')
      .send({ phone_e164: '+919000000077' });
    const otpCodeForProd = otpReqForProd.body.dev_mock_hint || (defaultOtpProvider as any).lastOtpCode || '123456';

    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const outboxProdRes = await request(app).get('/api/dev/outbox');
      expect(outboxProdRes.status).toBe(404);

      // Verify OTP in production mode: Set-Cookie has HttpOnly, SameSite=Lax, Secure
      const verProdRes = await request(app)
        .post('/api/auth/otp/verify')
        .send({
          phone_e164: '+919000000077',
          code: otpCodeForProd,
          name: 'Prod Cookie Test',
        });
      expect(verProdRes.status).toBe(200);
      const cookies = verProdRes.headers['set-cookie'] as unknown as string[];
      expect(Array.isArray(cookies)).toBe(true);
      const accessCookie = cookies.find((c) =>
        c.startsWith('saathi_access_token=')
      );
      expect(accessCookie).toBeDefined();
      expect(accessCookie).toMatch(/HttpOnly/i);
      expect(accessCookie).toMatch(/SameSite=Lax/i);
      expect(accessCookie).toMatch(/Secure/i);
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
    }
  });

  it('2. Authorization sweep: enumerates EVERY registered Express route, fails if any route is missing from REGISTERED_ROUTE_ACCESS_TABLE, and verifies responses across unauthenticated, non-owner user, owner, responder, and admin', async () => {
    const discoveredRoutes = extractExpressRoutes(app);
    expect(discoveredRoutes.length).toBeGreaterThan(35);

    const tableKeys = new Set(
      REGISTERED_ROUTE_ACCESS_TABLE.map((r) => `${r.method} ${r.path}`)
    );
    const discoveredKeys = new Set(
      discoveredRoutes.map((r) => `${r.method} ${r.path}`)
    );

    const missingFromTable = discoveredRoutes.filter(
      (r) => !tableKeys.has(`${r.method} ${r.path}`)
    );
    expect(missingFromTable).toEqual([]);

    const extraInTable = REGISTERED_ROUTE_ACCESS_TABLE.filter(
      (r) => !discoveredKeys.has(`${r.method} ${r.path}`)
    );
    expect(extraInTable).toEqual([]);

    // Enable DEMO_MODE temporarily so demo routes can be authorization-tested as well
    process.env.DEMO_MODE = 'true';
    resetRateLimiter();

    function resolvePath(template: string): string {
      return `/api${template}`
        .replace(':token', template.startsWith('/c/') ? contactMagicToken : invitationToken)
        .replace(
          ':id',
          template.includes('/contacts/')
            ? ownerContactId
            : template.includes('/journeys/')
              ? ownerJourneyId
              : template.includes('/reports/')
                ? reportId
                : template.includes('/resources/')
                  ? resourceId
                  : template.includes('/safety-tools/')
                    ? safetyToolId
                  : template.includes('/admin/responders/')
                    ? responderRowId
                    : ownerIncidentId
        );
    }

    for (const routeSpec of REGISTERED_ROUTE_ACCESS_TABLE) {
      // Skip POST /auth/logout in the loop so we don't clear any shared agent cookies, test it explicitly
      resetRateLimiter();
      const targetUrl = resolvePath(routeSpec.path);
      const method = routeSpec.method.toLowerCase() as
        | 'get'
        | 'post'
        | 'put'
        | 'patch'
        | 'delete';

      // 1. Unauthenticated request
      const unauthRes = await request(app)[method](targetUrl).send({});
      if (
        routeSpec.accessClass === 'any_user' ||
        routeSpec.accessClass === 'owner_only' ||
        routeSpec.accessClass === 'responder' ||
        routeSpec.accessClass === 'admin'
      ) {
        expect(
          unauthRes.status,
          `Expected 401 for unauthenticated ${routeSpec.method} ${routeSpec.path}, got ${unauthRes.status}`
        ).toBe(401);
      } else {
        expect(
          unauthRes.status,
          `Public/token route ${routeSpec.method} ${routeSpec.path} should not require session login`
        ).not.toBe(403);
      }

      // 2. Normal user (secondUserToken — not the owner of ownerUserId's resources)
      const userRes = await request(app)
        [method](targetUrl)
        .set('Authorization', `Bearer ${secondUserToken}`)
        .send({});
      if (
        routeSpec.accessClass === 'admin' ||
        routeSpec.accessClass === 'responder'
      ) {
        expect(
          userRes.status,
          `Expected 403 for normal user on ${routeSpec.method} ${routeSpec.path}, got ${userRes.status}`
        ).toBe(403);
      } else if (
        routeSpec.accessClass === 'owner_only' &&
        (routeSpec.path.includes(':id') ||
          routeSpec.path.startsWith('/demo/simulate/'))
      ) {
        const withValidProbeBody = await request(app)
          [method](targetUrl)
          .set('Authorization', `Bearer ${secondUserToken}`)
          .send(
            routeSpec.path === '/incidents/:id/location'
              ? { lat: 28.61, lng: 77.2 }
              : routeSpec.path === '/incidents/:id/type'
                ? { emergency_type: 'stalking' }
                : routeSpec.path === '/incidents/:id/rating'
                  ? { score: 5 }
                  : routeSpec.path === '/contacts/:id'
                    ? { name: 'Attempted Hijack' }
                    : routeSpec.path === '/demo/simulate/responder'
                      ? { action: 'acknowledge' }
                      : routeSpec.path === '/demo/simulate/contact'
                        ? { action: 'seen' }
                        : {}
          );
        expect(
          [403, 404].includes(withValidProbeBody.status),
          `Expected 403 or 404 for non-owner user on ${routeSpec.method} ${routeSpec.path}, got ${withValidProbeBody.status}`
        ).toBe(true);
      }

      // 3. Responder role
      const respRes = await request(app)
        [method](targetUrl)
        .set('Authorization', `Bearer ${responderToken}`)
        .send({});
      if (routeSpec.accessClass === 'admin') {
        expect(
          respRes.status,
          `Expected 403 for responder on admin route ${routeSpec.method} ${routeSpec.path}, got ${respRes.status}`
        ).toBe(403);
      }

      // 4. Admin role on responder-only incident queue routes
      if (
        routeSpec.accessClass === 'responder' &&
        routeSpec.path.startsWith('/responder/incidents')
      ) {
        const adminOnRespRes = await request(app)
          [method](targetUrl)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({});
        expect(
          adminOnRespRes.status,
          `Expected 403 for admin on responder-only route ${routeSpec.method} ${routeSpec.path}`
        ).toBe(403);
      }
    }

    delete process.env.DEMO_MODE;
  });

  it('3. CSRF & Origin protection + WebSocket Origin check: rejects cookie-authenticated state-changing requests with missing Origin+Referer or cross-origin Origin/Referer (403), allows public/token routes, and rejects WebSocket upgrades (/ws/incidents/:id, /ws/c/:token, /ws) from a foreign Origin (403)', async () => {
    // 3a. Missing BOTH Origin and Referer on a cookie-authenticated state-changing request -> 403
    const missingBothPost = await request(app)
      .post('/api/consents')
      .set('Cookie', `saathi_access_token=${ownerToken}`)
      .send({ type: 'microphone', granted: true });
    expect(missingBothPost.status).toBe(403);
    expect(missingBothPost.body.detail).toMatch(
      /Origin or Referer header is required/i
    );

    const missingBothPatch = await request(app)
      .patch('/api/me')
      .set('Cookie', `saathi_access_token=${ownerToken}`)
      .send({ name: 'Missing Origin and Referer' });
    expect(missingBothPatch.status).toBe(403);

    // 3b. Explicitly public/token-based routes with cookies present and missing Origin+Referer are NOT blocked by CSRF
    resetRateLimiter();
    const publicOtpWithCookie = await request(app)
      .post('/api/auth/otp/request')
      .set('Cookie', `saathi_access_token=${ownerToken}`)
      .send({ phone_e164: '+919000000077' });
    expect(publicOtpWithCookie.status).toBe(200);

    // Restore a fresh active incident + accepted contact + magic token for Test 3 after Test 2's /demo/reset
    await ownerAgent
      .post('/api/consents')
      .set('Origin', 'http://localhost:3000')
      .send({ type: 'data_processing', granted: true });
    await ownerAgent
      .post('/api/consents')
      .set('Origin', 'http://localhost:3000')
      .send({ type: 'location', granted: true });
    const cRes3 = await ownerAgent
      .post('/api/contacts')
      .set('Origin', 'http://localhost:3000')
      .send({
        name: 'WS Contact',
        phone_e164: '+919811199988',
        permissions: {
          receives_sos: true,
          receives_checkin: true,
          can_see_live_location: true,
        },
      });
    await request(app).post(`/api/invitations/${cRes3.body.invitation_token}/accept`);
    const activeBefore3 = await ownerAgent.get('/api/incidents/active');
    if (activeBefore3.body?.incident?.id) {
      await ownerAgent
        .post(`/api/incidents/${activeBefore3.body.incident.id}/resolve`)
        .set('Origin', 'http://localhost:3000')
        .send({ resolution: 'RESOLVED' });
    }
    const incRes3 = await ownerAgent
      .post('/api/incidents')
      .set('Origin', 'http://localhost:3000')
      .send({
        client_request_id: `csrf_ws_test_${Date.now()}`,
        location: { lat: 28.6139, lng: 77.209, accuracy_m: 10 },
      });
    ownerIncidentId = incRes3.body.incident.id;
    await transition(
      ownerIncidentId,
      'ACTIVE',
      { type: 'system', id: 'cancel_window_timer' },
      'Activated for CSRF/WS test',
      db
    );
    await dispatchInitialActiveNotifications(ownerIncidentId, db);
    const outbox3 = await request(app).get('/api/dev/outbox');
    const alertMsg3 = (
      outbox3.body.messages as Array<{
        purpose: string;
        metadata?: { incident_id?: string; token?: string };
      }>
    ).find(
      (m) =>
        m.purpose === 'sos_alert' &&
        m.metadata?.incident_id === ownerIncidentId &&
        m.metadata?.token
    );
    contactMagicToken = alertMsg3!.metadata!.token!;

    const tokenRespondWithCookie = await request(app)
      .post(`/api/c/${contactMagicToken}/respond`)
      .set('Cookie', `saathi_access_token=${ownerToken}`)
      .send({ action: 'seen' });
    expect(tokenRespondWithCookie.status).toBe(200);

    // 3c. Cross-origin POST with cookie auth must be rejected with 403
    const crossOriginPost = await ownerAgent
      .post('/api/consents')
      .set('Origin', 'https://malicious-attacker.example.com')
      .send({ type: 'microphone', granted: true });
    expect(crossOriginPost.status).toBe(403);
    expect(crossOriginPost.body.detail).toMatch(/CSRF/i);

    // 3d. Cross-origin Referer on PATCH /api/me with cookie auth must be rejected with 403
    const crossOriginReferer = await request(app)
      .patch('/api/me')
      .set('Cookie', `saathi_access_token=${ownerToken}`)
      .set('Referer', 'https://phishing.example.org/attack.html')
      .send({ name: 'Hijacked Name' });
    expect(crossOriginReferer.status).toBe(403);

    // 3e. Same-origin POST succeeds
    const sameOriginPost = await ownerAgent
      .post('/api/consents')
      .set('Origin', 'http://localhost:3000')
      .send({ type: 'microphone', granted: false });
    expect(sameOriginPost.status).toBe(201);

    // 3f. WebSocket upgrade Origin check on /ws/incidents/:id, /ws/c/:token, and /ws
    const server = http.createServer(app);
    const wss = attachWebSocketHub(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    const addr = server.address() as { port: number };
    const wsBase = `ws://127.0.0.1:${addr.port}`;
    const validOrigin = `http://127.0.0.1:${addr.port}`;

    const expectWsUpgradeStatus = (
      wsUrl: string,
      headers: Record<string, string>
    ): Promise<number> =>
      new Promise((resolve) => {
        const ws = new NodeWebSocket(wsUrl, { headers });
        ws.on('unexpected-response', (_req, res) => {
          resolve(res.statusCode || 0);
          ws.close();
        });
        ws.on('open', () => {
          resolve(101);
          ws.close();
        });
        ws.on('error', () => {
          // handled via unexpected-response
        });
      });

    try {
      // Foreign Origin rejected with 403 on /ws/incidents/:id
      const foreignIncidentStatus = await expectWsUpgradeStatus(
        `${wsBase}/ws/incidents/${ownerIncidentId}`,
        {
          Origin: 'https://foreign-attacker.example.com',
          Cookie: `saathi_access_token=${ownerToken}`,
        }
      );
      expect(foreignIncidentStatus).toBe(403);

      // Foreign Origin rejected with 403 on /ws/c/:token
      const foreignContactStatus = await expectWsUpgradeStatus(
        `${wsBase}/ws/c/${contactMagicToken}`,
        {
          Origin: 'https://foreign-attacker.example.com',
        }
      );
      expect(foreignContactStatus).toBe(403);

      // Foreign Origin rejected with 403 on /ws
      const foreignRootStatus = await expectWsUpgradeStatus(`${wsBase}/ws`, {
        Origin: 'https://foreign-attacker.example.com',
      });
      expect(foreignRootStatus).toBe(403);

      // Matching Origin accepted (101) on /ws/incidents/:id and /ws/c/:token
      const validIncidentStatus = await expectWsUpgradeStatus(
        `${wsBase}/ws/incidents/${ownerIncidentId}`,
        {
          Origin: validOrigin,
          Cookie: `saathi_access_token=${ownerToken}`,
        }
      );
      expect(validIncidentStatus).toBe(101);

      const validContactStatus = await expectWsUpgradeStatus(
        `${wsBase}/ws/c/${contactMagicToken}`,
        {
          Origin: validOrigin,
        }
      );
      expect(validContactStatus).toBe(101);
    } finally {
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('4. Security headers and rate limits: CSP (Vite + Leaflet tiles), nosniff, X-Frame-Options SAMEORIGIN + frame-ancestors none, Referrer-Policy; rate limits on OTP, PIN settings/attempts, contact-token endpoints, and report submission', async () => {
    const healthRes = await request(app).get('/api/health');
    expect(healthRes.headers['x-content-type-options']).toBe('nosniff');
    expect(healthRes.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(healthRes.headers['referrer-policy']).toBe(
      'strict-origin-when-cross-origin'
    );
    expect(healthRes.headers['content-security-policy']).toContain(
      "default-src 'self'"
    );
    expect(healthRes.headers['content-security-policy']).toContain(
      'https://*.tile.openstreetmap.org'
    );
    expect(healthRes.headers['content-security-policy']).toContain(
      "frame-ancestors 'none'"
    );

    // 4a. OTP request rate limit
    resetRateLimiter();
    for (let i = 0; i < config.authRateLimitPerMinute; i++) {
      const r = await request(app)
        .post('/api/auth/otp/request')
        .send({ phone_e164: '+919000000088' });
      expect(r.status).toBe(200);
    }
    const otpBlocked = await request(app)
      .post('/api/auth/otp/request')
      .send({ phone_e164: '+919000000088' });
    expect(otpBlocked.status).toBe(429);

    // 4b. PIN settings rate limit
    resetRateLimiter();
    for (let i = 0; i < config.pinSettingsRateLimitPerMinute; i++) {
      const r = await ownerAgent
        .put('/api/settings/cancel-pin')
        .send({ pin: '1234' });
      expect(r.status).toBe(200);
    }
    const pinBlocked = await ownerAgent
      .put('/api/settings/cancel-pin')
      .send({ pin: '1234' });
    expect(pinBlocked.status).toBe(429);

    // 4c. Contact token endpoint rate limit (GET /api/c/:token)
    resetRateLimiter();
    for (let i = 0; i < 15; i++) {
      const r = await request(app).get(`/api/c/${contactMagicToken}`);
      expect([200, 410].includes(r.status)).toBe(true);
    }
    const tokenBlocked = await request(app).get(`/api/c/${contactMagicToken}`);
    expect(tokenBlocked.status).toBe(429);

    // 4d. Report submission rate limit
    resetRateLimiter();
    for (let i = 0; i < config.reportDailyCapPerReporter; i++) {
      const r = await secondUserAgent.post('/api/reports').send({
        category: 'harassment',
        lat: 28.6139,
        lng: 77.209,
        anonymous: false,
      });
      expect(r.status).toBe(201);
    }
    const reportCapBlocked = await secondUserAgent.post('/api/reports').send({
      category: 'harassment',
      lat: 28.6139,
      lng: 77.209,
      anonymous: false,
    });
    expect(reportCapBlocked.status).toBe(429);
    resetRateLimiter();
  });

  it('5. Input validation sweep: rejects invalid payloads/queries with 400/422 and rejects oversize (>64KB) JSON bodies with 413', async () => {
    // Invalid query on /api/safety-layer
    const badSafetyQuery = await ownerAgent.get('/api/safety-layer?k=notanumber');
    expect(badSafetyQuery.status).toBe(422);

    // Invalid body on DELETE /api/me
    const badDeleteBody = await ownerAgent
      .delete('/api/me')
      .send({ confirmation: 12345 });
    expect(badDeleteBody.status).toBe(400);

    // Invalid body on PATCH /api/admin/responders/:id
    const badRespPatch = await adminAgent
      .patch(`/api/admin/responders/${responderRowId}`)
      .send({ unexpected_field: true });
    expect(badRespPatch.status).toBe(400);

    // Oversize body (>64KB) rejected with 413 Payload Too Large
    const hugeString = 'x'.repeat(80 * 1024);
    const oversizeRes = await ownerAgent
      .post('/api/incidents')
      .send({ client_request_id: hugeString });
    expect(oversizeRes.status).toBe(413);
  });

  it('6. Log / PII scan: runs login, SOS, contact response, responder action, and report submission while capturing console logs; finds zero phone numbers, tokens, PINs, or coordinates', async () => {
    const capturedLogs: string[] = [];
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    const origInfo = console.info;

    const capture = (...args: unknown[]) => {
      capturedLogs.push(
        args
          .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
          .join(' ')
      );
    };

    console.log = capture;
    console.warn = capture;
    console.error = capture;
    console.info = capture;

    const testPhone = '+919765432109';
    const testCancelPin = '4826';
    const testLat = 28.61432;
    const testLng = 77.20987;

    try {
      resetRateLimiter();
      // 1. Login flow
      const piiAgent = request.agent(app);
      piiAgent.set('Origin', 'http://localhost:3000');
      const otpReq = await piiAgent
        .post('/api/auth/otp/request')
        .send({ phone_e164: testPhone });
      expect(otpReq.status).toBe(200);
      const otpCode = otpReq.body.dev_mock_hint || (defaultOtpProvider as any).lastOtpCode || '123456';
      const otpVer = await piiAgent.post('/api/auth/otp/verify').send({
        phone_e164: testPhone,
        code: otpCode,
        name: 'PII Scan User',
      });
      expect(otpVer.status).toBe(200);

      // 2. Configure PIN & Consents
      await piiAgent
        .put('/api/settings/cancel-pin')
        .send({ pin: testCancelPin });
      await piiAgent
        .post('/api/consents')
        .send({ type: 'data_processing', granted: true });
      await piiAgent
        .post('/api/consents')
        .send({ type: 'location', granted: true });

      // 3. Add contact & accept invitation
      const cRes = await piiAgent.post('/api/contacts').send({
        name: 'Scan Contact',
        phone_e164: '+919888777666',
        permissions: {
          receives_sos: true,
          receives_checkin: true,
          can_see_live_location: true,
        },
      });
      const invTok = cRes.body.invitation_token as string;
      await request(app).post(`/api/invitations/${invTok}/accept`);

      // 4. Trigger SOS with coordinates, activate & dispatch
      const sosRes = await piiAgent.post('/api/incidents').send({
        client_request_id: 'pii_scan_sos_1',
        location: { lat: testLat, lng: testLng, accuracy_m: 8 },
      });
      const scanIncId = sosRes.body.incident.id as string;
      await transition(
        scanIncId,
        'ACTIVE',
        { type: 'system', id: 'cancel_window_timer' },
        'Activated after cancel window',
        db
      );
      await dispatchInitialActiveNotifications(scanIncId, db);

      // 5. Contact response via magic token
      const outbox = await request(app).get('/api/dev/outbox');
      const alertMsg = (
        outbox.body.messages as Array<{
          purpose: string;
          metadata?: { incident_id?: string; token?: string };
        }>
      ).find(
        (m) =>
          m.purpose === 'sos_alert' && m.metadata?.incident_id === scanIncId
      );
      const magicTok = alertMsg!.metadata!.token!;
      const cResp = await request(app)
        .post(`/api/c/${magicTok}/respond`)
        .send({ action: 'seen', note: 'Checking now' });
      expect(cResp.status).toBe(200);

      // 6. Responder action
      const rAck = await responderAgent
        .post(`/api/responder/incidents/${scanIncId}/acknowledge`)
        .send({ note: 'Responder acknowledging' });
      expect(rAck.status).toBe(200);

      // 7. Submit anonymous safety report
      const rep = await piiAgent.post('/api/reports').send({
        category: 'stalking',
        lat: testLat,
        lng: testLng,
        note: 'Test report',
        anonymous: true,
      });
      expect(rep.status).toBe(201);
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
      console.info = origInfo;
    }

    expect(capturedLogs.length).toBeGreaterThan(0);
    const combinedLogs = capturedLogs.join('\n');

    // Must contain zero phone numbers, zero invitation/contact/JWT tokens, zero PINs, zero coordinates
    expect(combinedLogs).not.toContain(testPhone);
    expect(combinedLogs).not.toContain('+919888777666');
    expect(combinedLogs).not.toMatch(/\+[1-9]\d{6,14}/);
    expect(combinedLogs).not.toMatch(/inv_[A-Za-z0-9_]+\.[A-Za-z0-9_]+/);
    expect(combinedLogs).not.toMatch(/ctk_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    expect(combinedLogs).not.toMatch(
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/
    );
    expect(combinedLogs).not.toContain(testCancelPin);
    expect(combinedLogs).not.toContain(String(testLat));
    expect(combinedLogs).not.toContain(String(testLng));
  });
});
