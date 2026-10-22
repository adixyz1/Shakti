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
import {
  incidents,
  locationSamples,
  notifications,
  sentMessages,
} from '../db/schema';
import { defaultAssistProvider } from '../providers/assist';
import { defaultEmergencyGateway } from '../providers/emergencyGateway';
import { defaultPushProvider } from '../providers/push';
import { defaultSmsProvider } from '../providers/sms';
import { runLocationRetentionPurge } from '../services/retentionService';
import {
  activateAndDispatchIncident,
  clearAllScheduledTimers,
  recoverPendingIncidentsOnStartup,
} from '../services/scheduler';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('SAATHI Phase 3B API Tests (Notifications, Escalation, Realtime WebSockets & Retention Purge)', () => {
  let tempDbPath: string;
  const app = createApp();

  beforeEach(async () => {
    clearAllScheduledTimers();
    resetRateLimiter();
    defaultPushProvider.reset();
    defaultSmsProvider.reset();
    defaultEmergencyGateway.reset();

    tempDbPath = path.join(
      os.tmpdir(),
      `saathi-phase3b-test-${crypto.randomUUID()}.db`
    );
    const db = await initDatabase(`file:${tempDbPath}`);
    await seedDatabase(db);
  });

  afterEach(async () => {
    clearAllScheduledTimers();
    defaultPushProvider.reset();
    defaultSmsProvider.reset();
    defaultEmergencyGateway.reset();
    await closeDatabase();
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const candidate = `${tempDbPath}${suffix}`;
      if (fs.existsSync(candidate)) {
        fs.unlinkSync(candidate);
      }
    }
  });

  async function loginPhone(phone: string, name?: string) {
    const agent = request.agent(app);
    agent.set('Origin', 'http://localhost:3000');
    const otpRes = await agent
      .post('/api/auth/otp/request')
      .send({ phone_e164: phone });
    const verifyRes = await agent
      .post('/api/auth/otp/verify')
      .send({ phone_e164: phone, code: (otpRes.body.dev_mock_hint || (defaultOtpProvider as any).lastOtpCode || "000000"), name });
    const setCookieHeader = verifyRes.headers['set-cookie'];
    return {
      agent,
      userId: verifyRes.body.id as string,
      cookies: Array.isArray(setCookieHeader)
        ? setCookieHeader.join('; ')
        : String(setCookieHeader || ''),
    };
  }

  async function createAndAcceptContact(
    agent: ReturnType<typeof request.agent>,
    name: string,
    phone: string,
    permissions = {
      receives_sos: true,
      receives_checkin: true,
      can_see_live_location: true,
    }
  ) {
    const res = await agent.post('/api/contacts').send({
      name,
      phone_e164: phone,
      permissions,
    });
    await request(app).post(
      `/api/invitations/${res.body.invitation_token}/accept`
    );
    return res.body.contact;
  }

  it('1. Happy path: create -> ACTIVE -> NOTIFIED -> resolve, with notification rows and deterministic non-AI path', async () => {
    // Verify AssistProvider is disabled by default and never imported in the SOS path
    expect(defaultAssistProvider.isEnabled).toBe(false);
    const incidentServiceSrc = fs.readFileSync(
      path.join(process.cwd(), 'apps/api/src/services/incidentService.ts'),
      'utf8'
    );
    const dispatcherSrc = fs.readFileSync(
      path.join(
        process.cwd(),
        'apps/api/src/services/notificationDispatcher.ts'
      ),
      'utf8'
    );
    expect(incidentServiceSrc).not.toMatch(/assist/i);
    expect(dispatcherSrc).not.toMatch(/assist/i);

    const { agent } = await loginPhone('+919000000001');
    const c1 = await createAndAcceptContact(
      agent,
      'Priya Priority 1',
      '+919800000001'
    );

    // Grant location consent so coordinates are included
    await agent.post('/api/consents').send({
      type: 'location',
      granted: true,
      source: 'consent_center',
    });

    await agent
      .put('/api/settings/cancel-window')
      .send({ cancel_window_seconds: 1 });

    const createRes = await agent.post('/api/incidents').send({
      client_request_id: 'req-3b-happy-path',
      location: { lat: 28.6139, lng: 77.209, accuracy_m: 10 },
    });
    expect(createRes.status).toBe(201);
    const incidentId = createRes.body.incident.id;
    expect(createRes.body.incident.status).toBe('TRIGGERED');

    // Wait for 1s cancel window -> TRIGGERED -> ACTIVE -> NOTIFIED
    await sleep(1200);

    const activeRes = await agent.get(`/api/incidents/${incidentId}`);
    expect(activeRes.status).toBe(200);
    expect(activeRes.body.incident.status).toBe('NOTIFIED');

    // Check notification rows in SQLite
    const db = getDb();
    const notifRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.incidentId, incidentId));
    const contactNotifRows = notifRows.filter(
      (n) => n.recipientType === 'contact'
    );
    expect(contactNotifRows).toHaveLength(2); // push + sms for Contact 1
    expect(contactNotifRows.every((n) => n.status === 'sent')).toBe(true);
    expect(contactNotifRows.every((n) => n.recipientRef === c1.id)).toBe(true);

    // Verify coordinates were included in the contact push message because location consent is true
    const contactPushes = defaultPushProvider.sentPushes.filter(
      (p) => p.recipientRef === c1.id
    );
    expect(contactPushes).toHaveLength(1);
    expect(contactPushes[0].body).toContain('28.61390');

    // Resolve the incident
    const resolveRes = await agent
      .post(`/api/incidents/${incidentId}/resolve`)
      .send({ resolution: 'RESOLVED' });
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.incident.status).toBe('RESOLVED');
  });

  it('2. Cancel inside the window creates zero notifications', async () => {
    const { agent } = await loginPhone('+919000000001');
    await createAndAcceptContact(agent, 'Priya', '+919800000001');

    await agent
      .put('/api/settings/cancel-window')
      .send({ cancel_window_seconds: 1 });

    const createRes = await agent.post('/api/incidents').send({
      client_request_id: 'req-3b-cancel-zero-notifs',
    });
    const incidentId = createRes.body.incident.id;

    // Cancel immediately inside window
    const cancelRes = await agent
      .post(`/api/incidents/${incidentId}/cancel`)
      .send({ note: 'False tap' });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe('CANCELLED');

    // Wait past the 1s window to verify scheduler does not fire
    await sleep(1200);

    const db = getDb();
    const notifRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.incidentId, incidentId));
    expect(notifRows).toHaveLength(0);
    expect(defaultPushProvider.sentPushes).toHaveLength(0);
  });

  it('3. Only eligible contacts are notified; revoked consent excludes immediately; no-location-consent alert notifies without coordinates; duress incidents notify normally', async () => {
    const { agent } = await loginPhone('+919000000001');

    // Contact 1: invited only (not accepted) -> MUST NOT be notified
    await agent.post('/api/contacts').send({
      name: 'Invited Only',
      phone_e164: '+919800000011',
      permissions: {
        receives_sos: true,
        receives_checkin: true,
        can_see_live_location: true,
      },
    });

    // Contact 2: accepted, receives_sos=true -> ELIGIBLE (#1 eligible)
    const cEligible = await createAndAcceptContact(
      agent,
      'Accepted Eligible',
      '+919800000012'
    );

    // Location consent is NOT granted (default false) -> alert must still notify WITHOUT coordinates
    await agent.put('/api/settings/cancel-pin').send({ pin: '1111' });
    await agent.put('/api/settings/duress-pin').send({ pin: '9999' });
    await agent
      .put('/api/settings/cancel-window')
      .send({ cancel_window_seconds: 1 });

    const createRes = await agent.post('/api/incidents').send({
      client_request_id: 'req-3b-duress-no-loc',
      location: { lat: 19.076, lng: 72.8777, accuracy_m: 15 },
    });
    const incidentId = createRes.body.incident.id;

    // Enter duress PIN during cancel window -> incident continues and notifies contacts like normal
    const duressRes = await agent
      .post(`/api/incidents/${incidentId}/cancel`)
      .send({ pin: '9999' });
    expect(duressRes.status).toBe(200);
    expect(duressRes.body.status).toBe('CANCELLED'); // masked for owner

    await sleep(1200);

    const db = getDb();
    const notifRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.incidentId, incidentId));

    // Only cEligible was notified among contacts (push + sms), Invited Only was skipped
    const contactNotifRows = notifRows.filter(
      (n) => n.recipientType === 'contact'
    );
    expect(contactNotifRows).toHaveLength(2);
    expect(
      contactNotifRows.every((n) => n.recipientRef === cEligible.id)
    ).toBe(true);

    // Verify alert was sent WITHOUT coordinates because location consent was not granted
    const contactPushes = defaultPushProvider.sentPushes.filter(
      (p) => p.recipientRef === cEligible.id
    );
    expect(contactPushes).toHaveLength(1);
    expect(contactPushes[0].body).not.toContain('19.076');
    expect(contactPushes[0].body).not.toContain('Location:');

    // Now revoke data_processing consent and trigger a second incident -> 0 notifications sent
    await agent
      .post(`/api/incidents/${incidentId}/resolve`)
      .send({ resolution: 'RESOLVED' });
    await agent.post('/api/consents').send({
      type: 'data_processing',
      granted: false,
      source: 'consent_center',
    });

    const create2 = await agent.post('/api/incidents').send({
      client_request_id: 'req-3b-revoked-dp',
    });
    const inc2Id = create2.body.incident.id;
    await sleep(1200);

    const notifs2 = await db
      .select()
      .from(notifications)
      .where(eq(notifications.incidentId, inc2Id));
    expect(notifs2).toHaveLength(0);
  });

  it('4. Escalation ladder fires on no acknowledgement (t=0 contact 1 -> t=N remaining contacts -> t=M needs_user_action + mock 112 gateway) and resumes after simulated restart without duplicate sends', async () => {
    const { agent } = await loginPhone('+919000000001');
    const c1 = await createAndAcceptContact(
      agent,
      'Contact 1',
      '+919800000021'
    );
    const c2 = await createAndAcceptContact(
      agent,
      'Contact 2',
      '+919800000022'
    );
    const c3 = await createAndAcceptContact(
      agent,
      'Contact 3',
      '+919800000023'
    );

    // Create incident with 10s window so we can control activation & escalation timing in test
    await agent
      .put('/api/settings/cancel-window')
      .send({ cancel_window_seconds: 10 });

    const createRes = await agent.post('/api/incidents').send({
      client_request_id: 'req-3b-escalation-restart',
    });
    const incidentId = createRes.body.incident.id;
    clearAllScheduledTimers();

    const db = getDb();

    // Activate at t=0 with Step 1 = 5000ms, Step 2 = 10000ms
    await activateAndDispatchIncident(incidentId, db, {
      step1DelayMs: 5000,
      step2DelayMs: 10000,
    });

    // At t=0: ONLY Contact 1 is notified among contacts (2 rows: push + sms)
    let notifRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.incidentId, incidentId));
    const contactNotifsAtT0 = notifRows.filter(
      (n) => n.recipientType === 'contact'
    );
    expect(contactNotifsAtT0).toHaveLength(2);
    expect(contactNotifsAtT0.every((n) => n.recipientRef === c1.id)).toBe(true);

    // Simulate server restart while incident is NOTIFIED: clear all timers and call recoverPendingIncidentsOnStartup
    // with short test escalation timers (step1 = 150ms, step2 = 350ms)
    clearAllScheduledTimers();
    const recovered = await recoverPendingIncidentsOnStartup(db, 0, {
      step1DelayMs: 150,
      step2DelayMs: 350,
    });
    expect(recovered).toBe(1);

    // Verify Contact 1 was NOT sent duplicate notifications upon restart recovery
    notifRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.incidentId, incidentId));
    expect(notifRows.filter((n) => n.recipientRef === c1.id)).toHaveLength(2);

    // Wait 220ms -> Step 1 fires (notifies Contact 2 and Contact 3)
    await sleep(220);
    notifRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.incidentId, incidentId));
    expect(notifRows.filter((n) => n.recipientRef === c2.id)).toHaveLength(2);
    expect(notifRows.filter((n) => n.recipientRef === c3.id)).toHaveLength(2);

    // Wait another 220ms -> Step 2 fires (sets needs_user_action = true and dispatches mock 112 gateway)
    await sleep(220);
    const [incAfterStep2] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, incidentId));
    expect(incAfterStep2.needsUserAction).toBe(true);
    expect(incAfterStep2.escalationStage).toBe(2);
    expect(defaultEmergencyGateway.requests).toHaveLength(1);
    expect(defaultEmergencyGateway.requests[0].incidentId).toBe(incidentId);

    notifRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.incidentId, incidentId));
    const gatewayNotifs = notifRows.filter((n) => n.channel === 'gateway');
    expect(gatewayNotifs).toHaveLength(1);
    expect(gatewayNotifs[0].status).toBe('sent');
  });

  it('5 & 8. One provider failing does not stop the others, and the whole flow passes even when ALL providers fail/reject', async () => {
    const { agent } = await loginPhone('+919000000001');
    await createAndAcceptContact(agent, 'Contact 1', '+919800000031');

    const db = getDb();

    // Part A: PushProvider fails, SmsProvider succeeds -> incident still reaches NOTIFIED
    defaultPushProvider.setSimulateFailure(true, 'Push service down');
    defaultSmsProvider.setSimulateFailure(false);

    const create1 = await agent.post('/api/incidents').send({
      client_request_id: 'req-3b-partial-failure',
    });
    const inc1Id = create1.body.incident.id;
    clearAllScheduledTimers();

    await activateAndDispatchIncident(inc1Id, db, {
      step1DelayMs: 60000,
      step2DelayMs: 60000,
    });
    clearAllScheduledTimers();

    const [inc1Row] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, inc1Id));
    expect(inc1Row.status).toBe('NOTIFIED');

    const inc1Notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.incidentId, inc1Id));
    const pushNotif = inc1Notifs.find((n) => n.channel === 'push')!;
    const smsNotif = inc1Notifs.find((n) => n.channel === 'sms')!;
    expect(pushNotif.status).toBe('failed');
    expect(pushNotif.attempts).toBe(3); // retried 3 times with backoff
    expect(pushNotif.lastError).toContain('Push service down');
    expect(smsNotif.status).toBe('sent');
    expect(smsNotif.attempts).toBe(1);

    await agent
      .post(`/api/incidents/${inc1Id}/resolve`)
      .send({ resolution: 'RESOLVED' });

    // Part B: ALL providers (Push, SMS, and 112 Gateway) fail/reject -> incident still activates, escalates, sets needs_user_action, and resolves cleanly
    defaultPushProvider.setSimulateFailure(true, 'Push offline');
    defaultSmsProvider.setSimulateFailure(true, 'SMS gateway offline');
    defaultEmergencyGateway.setSimulationMode('reject', '112 gateway offline');

    const create2 = await agent.post('/api/incidents').send({
      client_request_id: 'req-3b-all-providers-down',
    });
    const inc2Id = create2.body.incident.id;
    clearAllScheduledTimers();

    await activateAndDispatchIncident(inc2Id, db, {
      step1DelayMs: 50,
      step2DelayMs: 120,
    });

    await sleep(450);

    const [inc2Row] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, inc2Id));
    // Because 0 notifications succeeded, status stays ACTIVE (not NOTIFIED), but needs_user_action is true so UI prompts 1-tap Call 112/181
    expect(inc2Row.status).toBe('ACTIVE');
    expect(inc2Row.needsUserAction).toBe(true);

    const inc2Notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.incidentId, inc2Id));
    expect(inc2Notifs.length).toBeGreaterThanOrEqual(3); // push, sms, gateway
    expect(inc2Notifs.every((n) => n.status === 'failed')).toBe(true);

    // Resolve still succeeds deterministically
    const resolve2 = await agent
      .post(`/api/incidents/${inc2Id}/resolve`)
      .send({ resolution: 'RESOLVED' });
    expect(resolve2.status).toBe(200);
    expect(resolve2.body.incident.status).toBe('RESOLVED');
  });

  it('6. WebSocket /ws/incidents/:id: sends current state on connect, pushes state changes to owner, and rejects a different user with 403', async () => {
    const server = http.createServer(app);
    attachWebSocketServer(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    try {
      const owner = await loginPhone('+919000000001');
      const otherUser = await loginPhone('+919000000099', 'Other User');

      await createAndAcceptContact(owner.agent, 'Priya', '+919800000041');
      await owner.agent
        .put('/api/settings/cancel-window')
        .send({ cancel_window_seconds: 1 });

      const createRes = await owner.agent.post('/api/incidents').send({
        client_request_id: 'req-3b-ws-incident-stream',
      });
      const incidentId = createRes.body.incident.id;

      // 1. Different user connecting to /ws/incidents/:id must be rejected (403 Forbidden)
      const unauthorizedWs = new WebSocket(
        `ws://127.0.0.1:${port}/ws/incidents/${incidentId}`,
        { headers: { Cookie: otherUser.cookies } }
      );
      const rejectedError = await new Promise<Error | null>((resolve) => {
        unauthorizedWs.once('error', (err) => resolve(err));
        unauthorizedWs.once('open', () => resolve(null));
      });
      expect(rejectedError).not.toBeNull();
      expect(String(rejectedError?.message)).toMatch(/403/);

      // 2. Owner connecting to /ws/incidents/:id receives initial `incident_state` immediately, followed by `incident_updated` pushes for ACTIVE and NOTIFIED
      const ownerEvents: any[] = [];
      const ownerWs = new WebSocket(
        `ws://127.0.0.1:${port}/ws/incidents/${incidentId}`,
        { headers: { Cookie: owner.cookies } }
      );

      ownerWs.on('message', (data) => {
        ownerEvents.push(JSON.parse(data.toString()));
      });

      await new Promise((res) => ownerWs.once('open', res));

      // Wait for 1s cancel window -> TRIGGERED -> ACTIVE -> NOTIFIED
      await sleep(1250);

      expect(ownerEvents.length).toBeGreaterThanOrEqual(3);
      expect(ownerEvents[0].type).toBe('incident_state');
      expect(ownerEvents[0].incident.id).toBe(incidentId);
      expect(ownerEvents[0].incident.status).toBe('TRIGGERED');

      const pushedStatuses = ownerEvents
        .filter((e) => e.type === 'incident_updated')
        .map((e) => e.incident.status);
      expect(pushedStatuses).toContain('ACTIVE');
      expect(pushedStatuses).toContain('NOTIFIED');

      ownerWs.close();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('7. Retention purge job deletes expired location_samples only and keeps unexpired samples', async () => {
    const { agent } = await loginPhone('+919000000001');
    await agent.post('/api/consents').send({
      type: 'location',
      granted: true,
      source: 'consent_center',
    });

    const createRes = await agent.post('/api/incidents').send({
      client_request_id: 'req-3b-retention-purge',
      location: { lat: 28.61, lng: 77.2, accuracy_m: 10 },
    });
    const incidentId = createRes.body.incident.id;

    // Add a second location sample
    await agent
      .post(`/api/incidents/${incidentId}/location`)
      .send({ lat: 28.62, lng: 77.21, accuracy_m: 8 });

    const db = getDb();
    const samplesBefore = await db
      .select()
      .from(locationSamples)
      .where(eq(locationSamples.incidentId, incidentId));
    expect(samplesBefore).toHaveLength(2);

    // Mark the first sample as expired (expiresAt in the past) while keeping the second sample in the future
    await db
      .update(locationSamples)
      .set({ expiresAt: Date.now() - 60_000 })
      .where(eq(locationSamples.id, samplesBefore[0].id));

    const purgeResult = await runLocationRetentionPurge(db);
    expect(purgeResult.deletedCount).toBe(1);

    const samplesAfter = await db
      .select()
      .from(locationSamples)
      .where(eq(locationSamples.incidentId, incidentId));
    expect(samplesAfter).toHaveLength(1);
    expect(samplesAfter[0].id).toBe(samplesBefore[1].id);
  });

  it('9. Pre-Phase 4A Fixes: (1) duress masking hides needs_user_action, escalation_stage, and notifications from owner REST & WS while responders/contacts/audit see real values; (2) security.ts uses async crypto.scrypt (not scryptSync)', async () => {
    // Verify security.ts uses async crypto.scrypt and not scryptSync
    const securitySrc = fs.readFileSync(
      path.join(process.cwd(), 'apps/api/src/core/security.ts'),
      'utf8'
    );
    expect(securitySrc).toContain('crypto.scrypt(');
    expect(securitySrc).not.toContain('scryptSync');

    const server = http.createServer(app);
    attachWebSocketServer(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    try {
      const owner = await loginPhone('+919000000001');
      const responder = await loginPhone('+919000000002');
      await createAndAcceptContact(owner.agent, 'Priya', '+919800000051');

      await owner.agent.put('/api/settings/cancel-pin').send({ pin: '2580' });
      await owner.agent.put('/api/settings/duress-pin').send({ pin: '9119' });
      await owner.agent
        .put('/api/settings/cancel-window')
        .send({ cancel_window_seconds: 10 });

      const createRes = await owner.agent.post('/api/incidents').send({
        client_request_id: 'req-duress-full-masking',
      });
      const incidentId = createRes.body.incident.id;

      // Connect owner to /ws/incidents/:id and responder to /ws
      const ownerWsMessages: any[] = [];
      const responderWsMessages: any[] = [];

      const ownerWs = new WebSocket(
        `ws://127.0.0.1:${port}/ws/incidents/${incidentId}`,
        { headers: { Cookie: owner.cookies } }
      );
      const responderWs = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        headers: { Cookie: responder.cookies },
      });

      ownerWs.on('message', (d) =>
        ownerWsMessages.push(JSON.parse(d.toString()))
      );
      responderWs.on('message', (d) =>
        responderWsMessages.push(JSON.parse(d.toString()))
      );

      await Promise.all([
        new Promise((res) => ownerWs.once('open', res)),
        new Promise((res) => responderWs.once('open', res)),
      ]);

      // Supply Duress PIN (9119)
      const duressCancel = await owner.agent
        .post(`/api/incidents/${incidentId}/cancel`)
        .send({ pin: '9119' });
      expect(duressCancel.status).toBe(200);
      expect(duressCancel.body.incident.status).toBe('CANCELLED');
      expect(duressCancel.body.incident.is_duress).toBe(false);
      expect(duressCancel.body.incident.needs_user_action).toBe(false);
      expect(duressCancel.body.incident.escalation_stage).toBe(0);
      expect(duressCancel.body.incident.notifications).toEqual([]);

      clearAllScheduledTimers();
      const db = getDb();

      // Trigger full activation + Step 1 + Step 2 escalation (sets needs_user_action=true, escalation_stage=2, creates notifications)
      await activateAndDispatchIncident(incidentId, db, {
        step1DelayMs: 40,
        step2DelayMs: 100,
      });
      await sleep(220);

      // Owner REST GET /api/incidents/:id must still look like a normal CANCELLED incident with NO escalation/notification details
      const ownerGet = await owner.agent.get(`/api/incidents/${incidentId}`);
      expect(ownerGet.status).toBe(200);
      expect(ownerGet.body.incident.status).toBe('CANCELLED');
      expect(ownerGet.body.incident.is_duress).toBe(false);
      expect(ownerGet.body.incident.needs_user_action).toBe(false);
      expect(ownerGet.body.incident.escalation_stage).toBe(0);
      expect(ownerGet.body.incident.activated_at).toBeNull();
      expect(ownerGet.body.incident.notifications).toEqual([]);
      expect(
        ownerGet.body.incident.events.every(
          (e: any) => !String(e.note).includes('Escalated') && e.to_status !== 'NOTIFIED'
        )
      ).toBe(true);

      // Owner WebSocket updates must also hide needs_user_action, escalation_stage, and notifications
      const ownerUpdates = ownerWsMessages.filter(
        (m) => m.type === 'incident_updated'
      );
      expect(ownerUpdates.length).toBeGreaterThanOrEqual(2);
      for (const msg of ownerUpdates) {
        expect(msg.incident.status).toBe('CANCELLED');
        expect(msg.incident.is_duress).toBe(false);
        expect(msg.incident.needs_user_action).toBe(false);
        expect(msg.incident.escalation_stage).toBe(0);
        expect(msg.incident.notifications).toEqual([]);
      }

      // Responder REST GET /api/incidents/:id and Responder WS see REAL status, needs_user_action=true, escalation_stage=2, and notifications
      const responderGet = await responder.agent.get(
        `/api/incidents/${incidentId}`
      );
      expect(responderGet.status).toBe(200);
      expect(responderGet.body.incident.status).toBe('NOTIFIED');
      expect(responderGet.body.incident.is_duress).toBe(true);
      expect(responderGet.body.incident.needs_user_action).toBe(true);
      expect(responderGet.body.incident.escalation_stage).toBe(2);
      expect(responderGet.body.incident.notifications.length).toBeGreaterThanOrEqual(3);

      const responderUpdates = responderWsMessages.filter(
        (m) => m.type === 'incident_updated' && m.incident.id === incidentId
      );
      const lastResponderMsg = responderUpdates[responderUpdates.length - 1];
      expect(lastResponderMsg.incident.status).toBe('NOTIFIED');
      expect(lastResponderMsg.incident.is_duress).toBe(true);
      expect(lastResponderMsg.incident.needs_user_action).toBe(true);
      expect(lastResponderMsg.incident.escalation_stage).toBe(2);
      expect(lastResponderMsg.incident.notifications.length).toBeGreaterThanOrEqual(3);

      ownerWs.close();
      responderWs.close();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
