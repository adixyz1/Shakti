import { defaultOtpProvider } from '../providers/otp';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { WebSocket } from 'ws';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { attachWebSocketServer, createApp } from '../../server';
import { closeDatabase, getDb, initDatabase } from '../core/db';
import { resetRateLimiter } from '../core/middleware';
import { seedDatabase } from '../core/seed';
import { incidentEvents, incidents, users } from '../db/schema';
import { getNotifiableContacts } from '../services/contactService';
import { getHydratedIncident } from '../services/incidentService';
import { transition } from '../services/incidentStateMachine';
import {
  clearAllScheduledTimers,
  recoverPendingIncidentsOnStartup,
} from '../services/scheduler';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('SAATHI Phase 3A API Tests (SOS Engine Core, State Machine, Duress, Scheduler & Consent Rules)', () => {
  let tempDbPath: string;
  const app = createApp();

  beforeEach(async () => {
    clearAllScheduledTimers();
    resetRateLimiter();
    tempDbPath = path.join(
      os.tmpdir(),
      `saathi-phase3a-test-${crypto.randomUUID()}.db`
    );
    const db = await initDatabase(`file:${tempDbPath}`);
    await seedDatabase(db);
  });

  afterEach(async () => {
    clearAllScheduledTimers();
    await closeDatabase();
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const candidate = `${tempDbPath}${suffix}`;
      if (fs.existsSync(candidate)) {
        fs.unlinkSync(candidate);
      }
    }
  });

  async function loginDemoUser() {
    const agent = request.agent(app);
    agent.set('Origin', 'http://localhost:3000');
    const phone = '+919000000001';
    const otpRes = await agent
      .post('/api/auth/otp/request')
      .send({ phone_e164: phone });
    const verifyRes = await agent
      .post('/api/auth/otp/verify')
      .send({ phone_e164: phone, code: (otpRes.body.dev_mock_hint || (defaultOtpProvider as any).lastOtpCode || "000000")});
    const setCookieHeader = verifyRes.headers['set-cookie'];
    return {
      agent,
      userId: verifyRes.body.id as string,
      cookies: Array.isArray(setCookieHeader)
        ? setCookieHeader.join('; ')
        : String(setCookieHeader || ''),
    };
  }

  async function loginResponder() {
    const agent = request.agent(app);
    agent.set('Origin', 'http://localhost:3000');
    const phone = '+919000000002';
    const otpRes = await agent
      .post('/api/auth/otp/request')
      .send({ phone_e164: phone });
    const verifyRes = await agent
      .post('/api/auth/otp/verify')
      .send({ phone_e164: phone, code: (otpRes.body.dev_mock_hint || (defaultOtpProvider as any).lastOtpCode || "000000")});
    const setCookieHeader = verifyRes.headers['set-cookie'];
    return {
      agent,
      userId: verifyRes.body.id as string,
      cookies: Array.isArray(setCookieHeader)
        ? setCookieHeader.join('; ')
        : String(setCookieHeader || ''),
    };
  }

  it('Fix 1: seeds demo user with data_processing consent and exposes notifiable_contacts_count on contacts and incidents APIs', async () => {
    const { agent, userId } = await loginDemoUser();

    // 1. Seeded demo user starts with data_processing = true
    const consentsRes = await agent.get('/api/consents');
    expect(consentsRes.status).toBe(200);
    expect(consentsRes.body.current.data_processing).toBe(true);

    // 2. Contacts API exposes notifiable_contacts_count = 0 before any accepted contacts
    const list0 = await agent.get('/api/contacts');
    expect(list0.status).toBe(200);
    expect(list0.body.notifiable_contacts_count).toBe(0);

    // 3. Create contact (still invited -> notifiable_contacts_count = 0)
    const cRes = await agent.post('/api/contacts').send({
      name: 'Meenakshi',
      phone_e164: '+919810000001',
      permissions: {
        receives_sos: true,
        receives_checkin: true,
        can_see_live_location: true,
      },
    });
    expect(cRes.status).toBe(201);
    expect(cRes.body.notifiable_contacts_count).toBe(0);

    // 4. Accept contact -> notifiable_contacts_count becomes 1 (thanks to seeded data_processing)
    await request(app).post(
      `/api/invitations/${cRes.body.invitation_token}/accept`
    );
    expect(await getNotifiableContacts(userId, 'sos')).toHaveLength(1);

    const list1 = await agent.get('/api/contacts');
    expect(list1.body.notifiable_contacts_count).toBe(1);

    // 5. GET /api/incidents/active and GET /api/incidents/:id expose notifiable_contacts_count
    const activeEmpty = await agent.get('/api/incidents/active');
    expect(activeEmpty.status).toBe(200);
    expect(activeEmpty.body.notifiable_contacts_count).toBe(1);

    const incRes = await agent.post('/api/incidents').send({
      client_request_id: 'req-notifiable-count-test',
    });
    expect(incRes.status).toBe(201);
    expect(incRes.body.notifiable_contacts_count).toBe(1);
    expect(incRes.body.incident.notifiable_contacts_count).toBe(1);

    const getById = await agent.get(
      `/api/incidents/${incRes.body.incident.id}`
    );
    expect(getById.status).toBe(200);
    expect(getById.body.notifiable_contacts_count).toBe(1);
    expect(getById.body.incident.notifiable_contacts_count).toBe(1);

    // 6. User with NO location consent still alerts contacts for 'sos'; revoking data_processing drops count to 0
    await agent.post('/api/consents').send({
      type: 'location',
      granted: false,
      source: 'consent_center',
    });
    expect(await getNotifiableContacts(userId, 'sos')).toHaveLength(1);
    expect(await getNotifiableContacts(userId, 'live_location')).toHaveLength(0);

    await agent.post('/api/consents').send({
      type: 'data_processing',
      granted: false,
      source: 'consent_center',
    });
    expect(await getNotifiableContacts(userId, 'sos')).toHaveLength(0);
    const activeAfterRevoke = await agent.get('/api/incidents/active');
    expect(activeAfterRevoke.body.notifiable_contacts_count).toBe(0);
  });

  it('allows SOS incident creation with no location consent and zero contacts', async () => {
    const { agent } = await loginDemoUser();

    // Explicitly revoke location and data_processing consents; 0 trusted contacts exist
    await agent.post('/api/consents').send({
      type: 'location',
      granted: false,
      source: 'consent_center',
    });
    await agent.post('/api/consents').send({
      type: 'data_processing',
      granted: false,
      source: 'consent_center',
    });

    const createRes = await agent.post('/api/incidents').send({
      client_request_id: 'req-no-consents-zero-contacts',
      source_trigger: 'button',
      location: { lat: 28.6139, lng: 77.209, accuracy_m: 12 },
    });

    expect(createRes.status).toBe(201);
    expect(createRes.body.incident.status).toBe('TRIGGERED');
    expect(createRes.body.notifiable_contacts_count).toBe(0);
    expect(createRes.body.incident.locations).toHaveLength(0);
    expect(createRes.body.incident.events).toHaveLength(1);
    expect(createRes.body.incident.events[0].to_status).toBe('TRIGGERED');
  });

  it('transitions TRIGGERED -> ACTIVE after cancel window and rejects cancellation after window', async () => {
    const { agent } = await loginDemoUser();

    const winRes = await agent
      .put('/api/settings/cancel-window')
      .send({ cancel_window_seconds: 1 });
    expect(winRes.status).toBe(200);
    expect(winRes.body.cancel_window_seconds).toBe(1);

    const createRes = await agent.post('/api/incidents').send({
      client_request_id: 'req-auto-activate',
      source_trigger: 'button',
    });
    expect(createRes.status).toBe(201);
    const incidentId = createRes.body.incident.id;
    expect(createRes.body.incident.status).toBe('TRIGGERED');

    await sleep(1150);

    const activeRes = await agent.get('/api/incidents/active');
    expect(activeRes.status).toBe(200);
    expect(activeRes.body.incident.id).toBe(incidentId);
    expect(activeRes.body.incident.status).toBe('ACTIVE');
    expect(activeRes.body.incident.activated_at).toBeTruthy();

    const transitions = activeRes.body.incident.events.map(
      (e: any) => `${e.from_status ?? 'NULL'}->${e.to_status}`
    );
    expect(transitions).toEqual(['NULL->TRIGGERED', 'TRIGGERED->ACTIVE']);

    const lateCancel = await agent
      .post(`/api/incidents/${incidentId}/cancel`)
      .send({});
    expect(lateCancel.status).toBe(400);
    expect(lateCancel.body.detail).toMatch(/only allowed during the TRIGGERED/i);
  });

  it('cancels an incident inside the cancel window (plain cancel when no PIN configured) and records the CANCELLED event', async () => {
    const { agent } = await loginDemoUser();

    const createRes = await agent.post('/api/incidents').send({
      client_request_id: 'req-cancel-in-window',
    });
    expect(createRes.status).toBe(201);
    const incidentId = createRes.body.incident.id;

    const cancelRes = await agent
      .post(`/api/incidents/${incidentId}/cancel`)
      .send({ note: 'Accidental tap' });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe('CANCELLED');
    expect(cancelRes.body.incident.status).toBe('CANCELLED');
    expect(cancelRes.body.incident.closed_at).toBeTruthy();

    const activeRes = await agent.get('/api/incidents/active');
    expect(activeRes.body.incident).toBeNull();
  });

  it('handles idempotent create and merges duplicate triggers within the 3-minute window', async () => {
    const { agent } = await loginDemoUser();

    const first = await agent.post('/api/incidents').send({
      client_request_id: 'req-primary-1',
      source_trigger: 'button',
    });
    expect(first.status).toBe(201);
    const primaryId = first.body.incident.id;

    const replay = await agent.post('/api/incidents').send({
      client_request_id: 'req-primary-1',
      source_trigger: 'button',
    });
    expect(replay.status).toBe(200);
    expect(replay.body.idempotent_replay).toBe(true);
    expect(replay.body.incident.id).toBe(primaryId);

    const duplicate = await agent.post('/api/incidents').send({
      client_request_id: 'req-duplicate-2',
      source_trigger: 'shake',
    });
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.merged_into_existing).toBe(true);
    expect(duplicate.body.incident.id).toBe(primaryId);

    const db = getDb();
    const allIncidents = await db.select().from(incidents);
    const mergedRow = allIncidents.find(
      (r) => r.clientRequestId === 'req-duplicate-2'
    );
    expect(mergedRow).toBeDefined();
    expect(mergedRow!.mergedIntoId).toBe(primaryId);
  });

  it('Fix 2: enforces all 4 PIN cases when duress PIN and cancel PIN are configured (no PIN -> rejected, wrong PIN -> rejected, cancel PIN -> really cancels, duress PIN -> identical 200 CANCELLED response while incident continues)', async () => {
    const { agent } = await loginDemoUser();

    // Configure real cancel PIN = 2580 and duress PIN = 9119
    const cancelPinRes = await agent
      .put('/api/settings/cancel-pin')
      .send({ pin: '2580' });
    expect(cancelPinRes.status).toBe(200);
    expect(cancelPinRes.body.cancel_pin_configured).toBe(true);

    const duressPinRes = await agent
      .put('/api/settings/duress-pin')
      .send({ pin: '9119' });
    expect(duressPinRes.status).toBe(200);
    expect(duressPinRes.body.duress_pin_configured).toBe(true);

    const create1 = await agent.post('/api/incidents').send({
      client_request_id: 'req-pin-cases-1',
    });
    const inc1Id = create1.body.incident.id;

    // Case 1: No PIN supplied -> rejected with 400, incident continues
    const noPinRes = await agent
      .post(`/api/incidents/${inc1Id}/cancel`)
      .send({});
    expect(noPinRes.status).toBe(400);
    expect(noPinRes.body.detail).toMatch(/PIN is required/i);

    // Case 2: Wrong PIN supplied -> rejected with 400, incident continues
    const wrongPinRes = await agent
      .post(`/api/incidents/${inc1Id}/cancel`)
      .send({ pin: '0000' });
    expect(wrongPinRes.status).toBe(400);
    expect(wrongPinRes.body.detail).toBe('Invalid PIN.');

    // Verify inc1 is still TRIGGERED in DB
    const db = getDb();
    const [inc1StillOpen] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, inc1Id));
    expect(inc1StillOpen.status).toBe('TRIGGERED');

    // Case 3: Real Cancel PIN (2580) -> really cancels in DB
    const realCancelRes = await agent
      .post(`/api/incidents/${inc1Id}/cancel`)
      .send({ pin: '2580' });
    expect(realCancelRes.status).toBe(200);
    expect(realCancelRes.body.status).toBe('CANCELLED');
    expect(realCancelRes.body.incident.status).toBe('CANCELLED');

    const [inc1AfterRealCancel] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, inc1Id));
    expect(inc1AfterRealCancel.status).toBe('CANCELLED');
    expect(inc1AfterRealCancel.isDuress).toBe(false);

    // Case 4: Duress PIN (9119) on a fresh incident -> identical-looking 200 CANCELLED response, incident continues in DB
    await agent
      .put('/api/settings/cancel-window')
      .send({ cancel_window_seconds: 1 });

    const create2 = await agent.post('/api/incidents').send({
      client_request_id: 'req-pin-cases-2-duress',
    });
    const inc2Id = create2.body.incident.id;

    const duressCancelRes = await agent
      .post(`/api/incidents/${inc2Id}/cancel`)
      .send({ pin: '9119' });
    expect(duressCancelRes.status).toBe(200);
    expect(duressCancelRes.body.status).toBe('CANCELLED');
    expect(duressCancelRes.body.incident.status).toBe('CANCELLED');
    expect(duressCancelRes.body.incident.is_duress).toBe(false);
    expect(duressCancelRes.body.incident.closed_at).toBeTruthy();

    await sleep(1150);

    // In SQLite DB, incident 2 is actually ACTIVE with isDuress = true
    const [inc2InDb] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, inc2Id));
    expect(inc2InDb.status).toBe('ACTIVE');
    expect(inc2InDb.isDuress).toBe(true);
    expect(inc2InDb.closedAt).toBeNull();
  });

  it('Fix 3: for incidents with is_duress = true, owner-facing REST and WebSocket responses present status as CANCELLED while responders, contacts, and audit log see the real status', async () => {
    const server = http.createServer(app);
    attachWebSocketServer(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    try {
      const owner = await loginDemoUser();
      const responder = await loginResponder();

      // Configure cancel PIN and duress PIN
      await owner.agent.put('/api/settings/cancel-pin').send({ pin: '2580' });
      await owner.agent.put('/api/settings/duress-pin').send({ pin: '9119' });
      await owner.agent
        .put('/api/settings/cancel-window')
        .send({ cancel_window_seconds: 1 });

      // Connect two WebSocket clients: one as the owner, one as a responder
      const ownerMessages: any[] = [];
      const responderMessages: any[] = [];

      const ownerWs = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        headers: { Cookie: owner.cookies },
      });
      const responderWs = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        headers: { Cookie: responder.cookies },
      });

      ownerWs.on('message', (data) => {
        ownerMessages.push(JSON.parse(data.toString()));
      });
      responderWs.on('message', (data) => {
        responderMessages.push(JSON.parse(data.toString()));
      });

      await Promise.all([
        new Promise((res) => ownerWs.once('open', res)),
        new Promise((res) => responderWs.once('open', res)),
      ]);

      // Trigger incident and enter duress PIN
      const createRes = await owner.agent.post('/api/incidents').send({
        client_request_id: 'req-duress-masking-test',
      });
      const incidentId = createRes.body.incident.id;

      await owner.agent
        .post(`/api/incidents/${incidentId}/cancel`)
        .send({ pin: '9119' });

      // Wait for scheduler to transition TRIGGERED -> ACTIVE and broadcast via WebSocket
      await sleep(1150);

      // 1. Owner REST responses must show CANCELLED and null active incident
      const ownerActiveRes = await owner.agent.get('/api/incidents/active');
      expect(ownerActiveRes.status).toBe(200);
      expect(ownerActiveRes.body.incident).toBeNull();

      const ownerGetRes = await owner.agent.get(`/api/incidents/${incidentId}`);
      expect(ownerGetRes.status).toBe(200);
      expect(ownerGetRes.body.incident.status).toBe('CANCELLED');
      expect(ownerGetRes.body.incident.is_duress).toBe(false);

      // 2. Responder REST response sees the REAL status (ACTIVE) and is_duress = true
      const responderGetRes = await responder.agent.get(
        `/api/incidents/${incidentId}`
      );
      expect(responderGetRes.status).toBe(200);
      expect(responderGetRes.body.incident.status).toBe('ACTIVE');
      expect(responderGetRes.body.incident.is_duress).toBe(true);

      // 3. Contact-facing view via getHydratedIncident(..., { viewerRole: 'contact' }) sees REAL status
      const db = getDb();
      const contactView = await getHydratedIncident(db, incidentId, undefined, {
        viewerRole: 'contact',
      });
      expect(contactView.status).toBe('ACTIVE');
      expect(contactView.is_duress).toBe(true);

      // 4. Audit log (incident_events) in DB has the real duress and activation events
      const auditEvents = await db
        .select()
        .from(incidentEvents)
        .where(eq(incidentEvents.incidentId, incidentId));
      expect(
        auditEvents.some((e) =>
          String(e.note).includes('Duress PIN supplied')
        )
      ).toBe(true);
      expect(auditEvents.some((e) => e.toStatus === 'ACTIVE')).toBe(true);

      // 5. WebSocket updates: Owner WS receives status = 'CANCELLED', Responder WS receives status = 'ACTIVE'
      const ownerUpdates = ownerMessages.filter(
        (m) => m.type === 'incident_updated' && m.incident.id === incidentId
      );
      const responderUpdates = responderMessages.filter(
        (m) => m.type === 'incident_updated' && m.incident.id === incidentId
      );
      expect(ownerUpdates.length).toBeGreaterThanOrEqual(2);
      expect(responderUpdates.length).toBeGreaterThanOrEqual(2);

      const latestOwnerWs = ownerUpdates[ownerUpdates.length - 1];
      const latestResponderWs = responderUpdates[responderUpdates.length - 1];

      expect(latestOwnerWs.incident.status).toBe('CANCELLED');
      expect(latestOwnerWs.incident.is_duress).toBe(false);
      expect(latestResponderWs.incident.status).toBe('ACTIVE');
      expect(latestResponderWs.incident.is_duress).toBe(true);

      ownerWs.close();
      responderWs.close();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('enforces state machine transitions, rejects invalid transitions, and records location samples + resolution', async () => {
    const { agent, userId } = await loginDemoUser();

    const createRes = await agent.post('/api/incidents').send({
      client_request_id: 'req-state-machine',
    });
    const incidentId = createRes.body.incident.id;

    await expect(
      transition(incidentId, 'RESOLVED', { type: 'user', id: userId })
    ).rejects.toThrow(/Invalid state transition from TRIGGERED to RESOLVED/);

    await transition(
      incidentId,
      'ACTIVE',
      { type: 'system' },
      'Activated for test'
    );
    await transition(
      incidentId,
      'NOTIFIED',
      { type: 'system' },
      'Contacts notified'
    );
    await transition(
      incidentId,
      'ACKNOWLEDGED',
      { type: 'contact', id: 'c1' },
      'Contact acknowledged'
    );
    await transition(
      incidentId,
      'RESPONDING',
      { type: 'responder', id: 'r1' },
      'Responder en route'
    );

    await expect(
      transition(incidentId, 'CANCELLED', { type: 'user', id: userId })
    ).rejects.toThrow(/Invalid state transition from RESPONDING to CANCELLED/);

    const typeRes = await agent
      .post(`/api/incidents/${incidentId}/type`)
      .send({ emergency_type: 'unsafe_transport' });
    expect(typeRes.status).toBe(200);
    expect(typeRes.body.incident.emergency_type).toBe('unsafe_transport');

    const locRes = await agent
      .post(`/api/incidents/${incidentId}/location`)
      .send({ lat: 19.076, lng: 72.8777, accuracy_m: 8.5 });
    expect(locRes.status).toBe(201);
    expect(locRes.body.location.lat).toBe(19.076);
    expect(locRes.body.location.expires_at).toBeGreaterThan(Date.now());

    const resolveRes = await agent
      .post(`/api/incidents/${incidentId}/resolve`)
      .send({ resolution: 'RESOLVED', note: 'Arrived home safely' });
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.incident.status).toBe('RESOLVED');
    expect(resolveRes.body.incident.closed_at).toBeTruthy();

    const closedLocRes = await agent
      .post(`/api/incidents/${incidentId}/location`)
      .send({ lat: 19.08, lng: 72.88 });
    expect(closedLocRes.status).toBe(400);

    await expect(
      transition(incidentId, 'ACTIVE', { type: 'system' })
    ).rejects.toThrow(/Invalid state transition from RESOLVED to ACTIVE/);

    const db = getDb();
    const events = await db
      .select()
      .from(incidentEvents)
      .where(eq(incidentEvents.incidentId, incidentId));
    expect(events).toHaveLength(7);
  });

  it('resumes TRIGGERED incidents after simulated server restart via recoverPendingIncidentsOnStartup', async () => {
    const { agent } = await loginDemoUser();

    await agent
      .put('/api/settings/cancel-window')
      .send({ cancel_window_seconds: 10 });

    const createRes = await agent.post('/api/incidents').send({
      client_request_id: 'req-restart-recovery',
    });
    const incidentId = createRes.body.incident.id;
    expect(createRes.body.incident.status).toBe('TRIGGERED');

    clearAllScheduledTimers();

    const db = getDb();
    const recoveredCount = await recoverPendingIncidentsOnStartup(db, 120);
    expect(recoveredCount).toBe(1);

    await sleep(220);

    const checkRes = await agent.get(`/api/incidents/${incidentId}`);
    expect(checkRes.status).toBe(200);
    expect(checkRes.body.incident.status).toBe('ACTIVE');
    expect(checkRes.body.incident.activated_at).toBeTruthy();
  });

  it('stores PINs with a slow salted scrypt hash and rate-limits PIN attempts (5 wrong attempts per incident then rejects further attempts with identical 400 Invalid PIN response, plus rate-limits PIN settings endpoints)', async () => {
    const { agent, userId } = await loginDemoUser();

    // 1. Configure cancel PIN and duress PIN
    await agent.put('/api/settings/cancel-pin').send({ pin: '2580' });
    await agent.put('/api/settings/duress-pin').send({ pin: '9119' });

    // Verify stored hashes in SQLite use salted scrypt format (`scrypt$<randomSalt>$<derivedKey>`)
    const db = getDb();
    const [userRow] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId));
    expect(userRow.cancelPinHash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(userRow.duressPinHash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);

    // 2. Create incident and make 5 wrong PIN attempts
    const createRes = await agent.post('/api/incidents').send({
      client_request_id: 'req-pin-rate-limit',
    });
    const incidentId = createRes.body.incident.id;

    for (let i = 1; i <= 5; i++) {
      const wrongRes = await agent
        .post(`/api/incidents/${incidentId}/cancel`)
        .send({ pin: `000${i}` });
      expect(wrongRes.status).toBe(400);
      expect(wrongRes.body.detail).toBe('Invalid PIN.');
    }

    // 6th attempt: even with the VALID cancel PIN (2580), it is rejected with the exact same response shape (400 Invalid PIN.) without revealing the limit
    const lockedCancelRes = await agent
      .post(`/api/incidents/${incidentId}/cancel`)
      .send({ pin: '2580' });
    expect(lockedCancelRes.status).toBe(400);
    expect(lockedCancelRes.body.detail).toBe('Invalid PIN.');

    // Incident remains open
    const [incInDb] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, incidentId));
    expect(incInDb.status).toBe('TRIGGERED');
    expect(incInDb.pinAttempts).toBe(5);

    // 3. Rate-limit PIN settings endpoints (default 10/min; 2 already used above -> 8 more allowed, 11th returns 429)
    for (let i = 0; i < 8; i++) {
      const okRes = await agent
        .put('/api/settings/cancel-pin')
        .send({ pin: '2580' });
      expect(okRes.status).toBe(200);
    }

    const rateLimitedSettingsRes = await agent
      .put('/api/settings/duress-pin')
      .send({ pin: '9119' });
    expect(rateLimitedSettingsRes.status).toBe(429);
  });
});
