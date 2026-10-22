import { defaultOtpProvider } from '../providers/otp';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { WebSocket as NodeWebSocket } from 'ws';
import { eq } from 'drizzle-orm';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp } from '../../server';
import { closeDatabase, initDatabase, type AppDatabase } from '../core/db';
import { resetRateLimiter } from '../core/middleware';
import { seedDatabase } from '../core/seed';
import {
  contactIncidentTokens,
  incidentEvents,
  incidents,
  sentMessages,
} from '../db/schema';
import {
  DURESS_SAFETY_NOTICE_EN,
  issueContactIncidentMagicToken,
} from '../services/contactIncidentTokenService';
import {
  clearAllScheduledTimers,
  hasScheduledEscalation,
  scheduleEscalationLadder,
} from '../services/scheduler';
import { attachWebSocketHub } from '../services/wsHub';

describe('SAATHI Phase 6A API Tests (Trusted Contact Magic Links, Scoping, Revocation, Escalation Stop & Duress Safety)', () => {
  let tempDbPath: string;
  let db: AppDatabase;
  let server: http.Server;
  let wss: ReturnType<typeof attachWebSocketHub>;
  let baseUrl: string;

  beforeEach(async () => {
    tempDbPath = path.join(
      os.tmpdir(),
      `saathi-phase6a-api-${crypto.randomUUID()}.db`
    );
    db = await initDatabase(`file:${tempDbPath}`);
    await seedDatabase(db);
    resetRateLimiter();

    const app = createApp();
    server = http.createServer(app);
    wss = attachWebSocketHub(server);

    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
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
  });

  async function loginAgent(phoneE164: string) {
    const agent = request.agent(baseUrl);
    agent.set('Origin', 'http://localhost:3000');
    const otpReq = await agent
      .post('/api/auth/otp/request')
      .send({ phone_e164: phoneE164 });
    const verifyRes = await agent.post('/api/auth/otp/verify').send({
      phone_e164: phoneE164,
      code: (otpReq.body.dev_mock_hint || (defaultOtpProvider as any).lastOtpCode || "000000"),
    });
    const setCookieHeader = verifyRes.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookieHeader)
      ? setCookieHeader.map((c: string) => c.split(';')[0]).join('; ')
      : String(setCookieHeader || '').split(';')[0];

    return { agent, cookieStr, user: verifyRes.body };
  }

  async function addAndAcceptContact(
    ownerAgent: ReturnType<typeof request.agent>,
    params: {
      name: string;
      phone_e164: string;
      receives_sos?: boolean;
      can_see_live_location?: boolean;
    }
  ) {
    const createRes = await ownerAgent.post('/api/contacts').send({
      name: params.name,
      phone_e164: params.phone_e164,
      permissions: {
        receives_sos: params.receives_sos ?? true,
        receives_checkin: true,
        can_see_live_location: params.can_see_live_location ?? true,
      },
    });
    expect(createRes.status).toBe(201);
    const acceptRes = await request(baseUrl)
      .post(`/api/invitations/${createRes.body.invitation_token}/accept`)
      .send();
    expect(acceptRes.status).toBe(200);
    return createRes.body.contact as {
      id: string;
      name: string;
      phone_e164: string;
    };
  }

  it('1. Magic-link token issuance & hashed storage: stored hashed in DB, included in dev outbox SMS, scoped to ONE contact + ONE incident, and expires when incident closes', async () => {
    const { agent: owner } = await loginAgent('+919000000001');
    await owner
      .put('/api/settings/cancel-window')
      .send({ cancel_window_seconds: 0 });
    await owner.post('/api/consents').send({
      type: 'location',
      granted: true,
      source: 'test',
    });

    const contact1 = await addAndAcceptContact(owner, {
      name: 'Priya Verma',
      phone_e164: '+919800000011',
      can_see_live_location: true,
    });

    // Trigger incident #1 (cancel_window_seconds=0 activates immediately and dispatches SMS to contact1)
    const createRes1 = await owner.post('/api/incidents').send({
      client_request_id: 'req_6a_token_1',
      source_trigger: 'button',
      emergency_type: 'followed',
      location: {
        lat: 28.6139,
        lng: 77.209,
        accuracy_m: 11,
      },
    });
    expect(createRes1.status).toBe(201);
    const incident1Id = createRes1.body.incident.id;

    // Inspect dev outbox for the magic link
    const outboxRes = await owner.get('/api/dev/outbox');
    expect(outboxRes.status).toBe(200);
    const sosMsg = outboxRes.body.messages.find(
      (m: any) =>
        m.purpose === 'sos_alert' && m.to_phone_e164 === contact1.phone_e164
    );
    expect(sosMsg).toBeTruthy();
    expect(sosMsg.body).toContain('/c/ctk_');
    expect(sosMsg.metadata.contact_url).toMatch(/^\/c\/ctk_/);

    const rawToken: string = sosMsg.metadata.token;
    expect(rawToken).toMatch(/^ctk_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    // Verify token is stored ONLY as a SHA-256 hash in `contact_incident_tokens` (never plain token in DB)
    const tokenRows = await db
      .select()
      .from(contactIncidentTokens)
      .where(eq(contactIncidentTokens.incidentId, incident1Id));
    expect(tokenRows).toHaveLength(1);
    expect(tokenRows[0].contactId).toBe(contact1.id);
    expect(tokenRows[0].tokenHash).not.toBe(rawToken);
    expect(tokenRows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);

    // Verify GET /api/c/:token works without login and returns scoped summary for contact1 + incident1
    const getSummaryRes = await request(baseUrl).get(`/api/c/${rawToken}`);
    expect(getSummaryRes.status).toBe(200);
    expect(getSummaryRes.body.incident_id).toBe(incident1Id);
    expect(getSummaryRes.body.contact_id).toBe(contact1.id);
    expect(getSummaryRes.body.user_first_name).toBe('Aarohi');
    expect(getSummaryRes.body.emergency_type).toBe('followed');
    expect(getSummaryRes.body.status).toBe('NOTIFIED');
    expect(getSummaryRes.body.location).toEqual(
      expect.objectContaining({
        lat: 28.6139,
        lng: 77.209,
        accuracy_m: 11,
      })
    );

    // Tampered signature must fail with 404
    const tamperedToken = `${rawToken.split('.')[0]}.0000000000000000000000000000000000000000000000000000000000000000`;
    const tamperedRes = await request(baseUrl).get(`/api/c/${tamperedToken}`);
    expect(tamperedRes.status).toBe(404);

    // When incident closes (RESOLVED), the token immediately stops working (410 Gone)
    await owner
      .post(`/api/incidents/${incident1Id}/resolve`)
      .send({ resolution: 'RESOLVED' });

    const afterCloseGet = await request(baseUrl).get(`/api/c/${rawToken}`);
    expect(afterCloseGet.status).toBe(410);
    expect(afterCloseGet.body.detail).toMatch(/closed/i);

    const afterClosePost = await request(baseUrl)
      .post(`/api/c/${rawToken}/respond`)
      .send({ action: 'seen' });
    expect(afterClosePost.status).toBe(410);
  });

  it('2. Real-time contact & consent revocation via getNotifiableContacts: pausing/removing contact or revoking consent stops link immediately; omitting location permission or location consent omits coordinates', async () => {
    const { agent: owner } = await loginAgent('+919000000001');
    await owner
      .put('/api/settings/cancel-window')
      .send({ cancel_window_seconds: 0 });
    await owner.post('/api/consents').send({
      type: 'location',
      granted: true,
      source: 'test',
    });

    const contact1 = await addAndAcceptContact(owner, {
      name: 'Kavita Rao',
      phone_e164: '+919800000012',
      can_see_live_location: true,
    });

    const createRes = await owner.post('/api/incidents').send({
      client_request_id: 'req_6a_revoke_1',
      source_trigger: 'button',
      location: {
        lat: 19.076,
        lng: 72.8777,
        accuracy_m: 15,
      },
    });
    const incidentId = createRes.body.incident.id;

    // Add a second location sample to verify ONLY the latest point is ever returned (no location history)
    await owner.post(`/api/incidents/${incidentId}/location`).send({
      lat: 19.08,
      lng: 72.89,
      accuracy_m: 8,
    });

    const outboxRes = await owner.get('/api/dev/outbox');
    const rawToken: string = outboxRes.body.messages.find(
      (m: any) =>
        m.purpose === 'sos_alert' && m.to_phone_e164 === contact1.phone_e164
    ).metadata.token;

    // 1. Initially both can_see_live_location and location consent are active -> latest point (19.08, 72.89) is included, no `locations` history array
    const initialGet = await request(baseUrl).get(`/api/c/${rawToken}`);
    expect(initialGet.status).toBe(200);
    expect(initialGet.body.can_see_live_location).toBe(true);
    expect(initialGet.body.location.lat).toBe(19.08);
    expect(initialGet.body.location.lng).toBe(72.89);
    expect(initialGet.body.locations).toBeUndefined();

    // 2. Turn off contact's `can_see_live_location` permission -> link still works, but coordinates are omitted entirely
    await owner.patch(`/api/contacts/${contact1.id}`).send({
      permissions: {
        receives_sos: true,
        receives_checkin: true,
        can_see_live_location: false,
      },
    });
    const noPermGet = await request(baseUrl).get(`/api/c/${rawToken}`);
    expect(noPermGet.status).toBe(200);
    expect(noPermGet.body.can_see_live_location).toBe(false);
    expect('location' in noPermGet.body).toBe(false);

    // Re-enable contact's `can_see_live_location`, then revoke user's `location` consent -> coordinates omitted entirely
    await owner.patch(`/api/contacts/${contact1.id}`).send({
      permissions: {
        receives_sos: true,
        receives_checkin: true,
        can_see_live_location: true,
      },
    });
    await owner.post('/api/consents').send({
      type: 'location',
      granted: false,
      source: 'test',
    });
    const noLocConsentGet = await request(baseUrl).get(`/api/c/${rawToken}`);
    expect(noLocConsentGet.status).toBe(200);
    expect(noLocConsentGet.body.can_see_live_location).toBe(false);
    expect('location' in noLocConsentGet.body).toBe(false);

    // 3. Pause the contact -> link stops working immediately (403)
    await owner.post(`/api/contacts/${contact1.id}/pause`).send();
    const pausedGet = await request(baseUrl).get(`/api/c/${rawToken}`);
    expect(pausedGet.status).toBe(403);

    // Resume contact -> works again
    await owner.post(`/api/contacts/${contact1.id}/resume`).send();
    const resumedGet = await request(baseUrl).get(`/api/c/${rawToken}`);
    expect(resumedGet.status).toBe(200);

    // 3b. User has NO `notifications` consent (explicitly revoked `notifications` consent) -> contact link STILL works (depends on `data_processing` consent only, same as getNotifiableContacts('sos'))
    await owner.post('/api/consents').send({
      type: 'notifications',
      granted: false,
      source: 'test',
    });
    const noNotificationsConsentGet = await request(baseUrl).get(
      `/api/c/${rawToken}`
    );
    expect(noNotificationsConsentGet.status).toBe(200);
    expect(noNotificationsConsentGet.body.incident_id).toBe(incidentId);

    const noNotificationsConsentPost = await request(baseUrl)
      .post(`/api/c/${rawToken}/respond`)
      .send({ action: 'seen' });
    expect(noNotificationsConsentPost.status).toBe(200);
    expect(noNotificationsConsentPost.body.incident_status).toBe('ACKNOWLEDGED');

    // 4. Revoke user's `data_processing` consent -> getNotifiableContacts returns [], link stops working immediately (403)
    await owner.post('/api/consents').send({
      type: 'data_processing',
      granted: false,
      source: 'test',
    });
    const revokedConsentGet = await request(baseUrl).get(`/api/c/${rawToken}`);
    expect(revokedConsentGet.status).toBe(403);

    // Re-grant `data_processing`, then remove contact -> link stops working immediately (403)
    await owner.post('/api/consents').send({
      type: 'data_processing',
      granted: true,
      source: 'test',
    });
    await owner.delete(`/api/contacts/${contact1.id}`).send();
    const removedGet = await request(baseUrl).get(`/api/c/${rawToken}`);
    expect(removedGet.status).toBe(403);
  });

  it('3. Contact response actions, state transitions, escalation cancellation & WebSocket push to owner: seen -> ACKNOWLEDGED (stops escalation from ACTIVE and NOTIFIED), on_my_way/calling_her -> RESPONDING, cannot_help -> event only, confirm_safe -> RESOLVED', async () => {
    const { agent: owner, cookieStr } = await loginAgent('+919000000001');
    await owner
      .put('/api/settings/cancel-window')
      .send({ cancel_window_seconds: 0 });

    const contact1 = await addAndAcceptContact(owner, {
      name: 'Meera Joshi',
      phone_e164: '+919800000013',
    });

    const createRes = await owner.post('/api/incidents').send({
      client_request_id: 'req_6a_actions_1',
      source_trigger: 'button',
    });
    const incidentId = createRes.body.incident.id;

    // Verify escalation ladder is currently scheduled for this open incident (status = NOTIFIED)
    const afterCreateGet = await owner.get(`/api/incidents/${incidentId}`);
    expect(afterCreateGet.body.incident.status).toBe('NOTIFIED');
    expect(hasScheduledEscalation(incidentId)).toBe(true);

    // Connect owner WebSocket to receive real-time contact response updates
    const wsMessages: any[] = [];
    const ws = new NodeWebSocket(
      `${baseUrl.replace('http', 'ws')}/api/ws/incidents/${incidentId}`,
      {
        headers: { Cookie: cookieStr },
      }
    );
    await new Promise<void>((resolve) => {
      ws.on('open', () => resolve());
    });
    ws.on('message', (raw) => {
      wsMessages.push(JSON.parse(raw.toString()));
    });

    const outboxRes = await owner.get('/api/dev/outbox');
    const rawToken: string = outboxRes.body.messages.find(
      (m: any) =>
        m.purpose === 'sos_alert' && m.to_phone_e164 === contact1.phone_e164
    ).metadata.token;

    // 1. Action: 'seen' -> moves NOTIFIED -> ACKNOWLEDGED and stops escalation ladder
    const seenRes = await request(baseUrl)
      .post(`/api/c/${rawToken}/respond`)
      .send({ action: 'seen' });
    expect(seenRes.status).toBe(200);
    expect(seenRes.body.incident_status).toBe('ACKNOWLEDGED');
    expect(hasScheduledEscalation(incidentId)).toBe(false);

    // 2. Action: 'cannot_help' -> writes incident_events row (actor_type='contact') without changing ACKNOWLEDGED status
    const cannotHelpRes = await request(baseUrl)
      .post(`/api/c/${rawToken}/respond`)
      .send({ action: 'cannot_help' });
    expect(cannotHelpRes.status).toBe(200);
    expect(cannotHelpRes.body.incident_status).toBe('ACKNOWLEDGED');

    // 3. Action: 'on_my_way' -> moves ACKNOWLEDGED -> RESPONDING
    const onMyWayRes = await request(baseUrl)
      .post(`/api/c/${rawToken}/respond`)
      .send({ action: 'on_my_way' });
    expect(onMyWayRes.status).toBe(200);
    expect(onMyWayRes.body.incident_status).toBe('RESPONDING');

    // 4. Action: 'calling_her' -> records event while staying in RESPONDING
    const callingHerRes = await request(baseUrl)
      .post(`/api/c/${rawToken}/respond`)
      .send({ action: 'calling_her' });
    expect(callingHerRes.status).toBe(200);
    expect(callingHerRes.body.incident_status).toBe('RESPONDING');

    // 5. Action: 'confirm_safe' -> closes incident (RESOLVED)
    const confirmSafeRes = await request(baseUrl)
      .post(`/api/c/${rawToken}/respond`)
      .send({ action: 'confirm_safe' });
    expect(confirmSafeRes.status).toBe(200);
    expect(confirmSafeRes.body.incident_status).toBe('RESOLVED');
    expect(confirmSafeRes.body.closed).toBe(true);

    // Wait briefly for all WebSocket messages to arrive at owner
    await new Promise((r) => setTimeout(r, 80));
    ws.close();

    const updatedStatuses = wsMessages
      .filter((m) => m.type === 'incident_updated')
      .map((m) => m.incident.status);
    expect(updatedStatuses).toContain('ACKNOWLEDGED');
    expect(updatedStatuses).toContain('RESPONDING');
    expect(updatedStatuses).toContain('RESOLVED');

    // Verify incident_events rows in DB have actorType === 'contact' and actorId === contact1.id
    const events = await db
      .select()
      .from(incidentEvents)
      .where(eq(incidentEvents.incidentId, incidentId));
    const contactEvents = events.filter((e) => e.actorType === 'contact');
    expect(contactEvents.length).toBe(5);
    expect(contactEvents.every((e) => e.actorId === contact1.id)).toBe(true);

    // 6. Verify 'seen' and 'calling_her' from pre-acknowledgement state ACTIVE also transition properly and stop escalation
    const activeIncRes = await owner.post('/api/incidents').send({
      client_request_id: 'req_6a_actions_active_state',
      source_trigger: 'button',
    });
    const activeIncId = activeIncRes.body.incident.id;
    // Set status in DB to pre-acknowledgement 'ACTIVE' and ensure escalation is scheduled
    await db
      .update(incidents)
      .set({ status: 'ACTIVE' })
      .where(eq(incidents.id, activeIncId));
    scheduleEscalationLadder(activeIncId, db);
    expect(hasScheduledEscalation(activeIncId)).toBe(true);

    const { token: activeToken } = await issueContactIncidentMagicToken(
      db,
      activeIncId,
      contact1.id
    );
    const seenFromActive = await request(baseUrl)
      .post(`/api/c/${activeToken}/respond`)
      .send({ action: 'seen' });
    expect(seenFromActive.status).toBe(200);
    expect(seenFromActive.body.incident_status).toBe('ACKNOWLEDGED');
    expect(hasScheduledEscalation(activeIncId)).toBe(false);

    // Reset to ACTIVE with escalation scheduled and verify 'calling_her' transitions ACTIVE -> RESPONDING and stops escalation
    await db
      .update(incidents)
      .set({ status: 'ACTIVE' })
      .where(eq(incidents.id, activeIncId));
    scheduleEscalationLadder(activeIncId, db);
    expect(hasScheduledEscalation(activeIncId)).toBe(true);

    const callingHerFromActive = await request(baseUrl)
      .post(`/api/c/${activeToken}/respond`)
      .send({ action: 'calling_her' });
    expect(callingHerFromActive.status).toBe(200);
    expect(callingHerFromActive.body.incident_status).toBe('RESPONDING');
    expect(hasScheduledEscalation(activeIncId)).toBe(false);
  });

  it('4. Duress incident awareness & masking: contact payload shows real status + safety notice & rejects calling_her; owner payloads & WS reveal nothing about contact activity and are structurally IDENTICAL to a genuine cancel; confirm_safe truly closes the duress incident', async () => {
    const { agent: owner, cookieStr } = await loginAgent('+919000000001');
    const { agent: responder } = await loginAgent('+919000000002');

    await owner
      .put('/api/settings/cancel-window')
      .send({ cancel_window_seconds: 1 });
    await owner
      .put('/api/settings/duress-pin')
      .send({ pin: '9999', cancel_pin: '1234' });
    await owner.post('/api/consents').send({
      type: 'location',
      granted: true,
      source: 'test',
    });

    const contact1 = await addAndAcceptContact(owner, {
      name: 'Ananya Sen',
      phone_e164: '+919800000014',
    });

    // Helper to normalize IDs and timestamps so two cancel payloads can be compared for 100% structural identity
    const normalizeOwnerCancelPayload = (payload: any): any => {
      if (Array.isArray(payload)) {
        return payload.map(normalizeOwnerCancelPayload);
      }
      if (payload && typeof payload === 'object') {
        const out: Record<string, any> = {};
        for (const key of Object.keys(payload).sort()) {
          if (
            key === 'id' ||
            key === 'incident_id' ||
            key === 'client_request_id'
          ) {
            out[key] = '<ID>';
          } else if (
            key === 'created_at' ||
            key === 'closed_at' ||
            key === 'captured_at' ||
            key === 'expires_at'
          ) {
            out[key] = payload[key] !== null ? '<TIMESTAMP>' : null;
          } else {
            out[key] = normalizeOwnerCancelPayload(payload[key]);
          }
        }
        return out;
      }
      return payload;
    };

    // Part A: Trigger a GENUINE incident and cancel with genuine Cancel PIN 1234
    const createGenuine = await owner.post('/api/incidents').send({
      client_request_id: 'req_6a_genuine_cancel_1',
      source_trigger: 'button',
      location: { lat: 28.6139, lng: 77.209, accuracy_m: 10 },
    });
    const genuineId = createGenuine.body.incident.id;

    const genuineCancelRes = await owner
      .post(`/api/incidents/${genuineId}/cancel`)
      .send({ pin: '1234' });
    expect(genuineCancelRes.status).toBe(200);
    expect(genuineCancelRes.body.status).toBe('CANCELLED');

    const genuineGetRes = await owner.get(`/api/incidents/${genuineId}`);
    expect(genuineGetRes.status).toBe(200);

    // Part B: Trigger a DURESS incident and cancel with Duress PIN 9999
    const createRes = await owner.post('/api/incidents').send({
      client_request_id: 'req_6a_duress_1',
      source_trigger: 'button',
      location: { lat: 28.6139, lng: 77.209, accuracy_m: 10 },
    });
    const incidentId = createRes.body.incident.id;

    // Connect owner WebSocket
    const ownerWsMessages: any[] = [];
    const ownerWs = new NodeWebSocket(
      `${baseUrl.replace('http', 'ws')}/api/ws/incidents/${incidentId}`,
      {
        headers: { Cookie: cookieStr },
      }
    );
    await new Promise<void>((resolve) => {
      ownerWs.on('open', () => resolve());
    });
    ownerWs.on('message', (raw) => {
      ownerWsMessages.push(JSON.parse(raw.toString()));
    });

    const cancelRes = await owner
      .post(`/api/incidents/${incidentId}/cancel`)
      .send({ pin: '9999' });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe('CANCELLED');

    // Verify POST /api/incidents/:id/cancel response for duress cancel is structurally IDENTICAL to genuine cancel
    expect(normalizeOwnerCancelPayload(cancelRes.body)).toEqual(
      normalizeOwnerCancelPayload(genuineCancelRes.body)
    );

    // Wait 1.2s for background duress activation & notification dispatch
    await new Promise((r) => setTimeout(r, 1200));

    const outboxRes = await owner.get('/api/dev/outbox');
    const rawToken: string = outboxRes.body.messages.find(
      (m: any) =>
        m.purpose === 'sos_alert' && m.to_phone_e164 === contact1.phone_e164
    ).metadata.token;

    // 1. Contact GET /api/c/:token sees REAL status ('NOTIFIED'), is_duress: true, and the exact duress safety notice
    const contactSummary = await request(baseUrl).get(`/api/c/${rawToken}`);
    expect(contactSummary.status).toBe(200);
    expect(contactSummary.body.status).toBe('NOTIFIED');
    expect(contactSummary.body.is_duress).toBe(true);
    expect(contactSummary.body.duress_notice).toBe(DURESS_SAFETY_NOTICE_EN);

    // 2. Contact attempting `calling_her` on a duress incident is rejected (400)
    const callingHerDuress = await request(baseUrl)
      .post(`/api/c/${rawToken}/respond`)
      .send({ action: 'calling_her' });
    expect(callingHerDuress.status).toBe(400);

    // 3. Contact responds `on_my_way` -> moves real incident to RESPONDING
    const onMyWayRes = await request(baseUrl)
      .post(`/api/c/${rawToken}/respond`)
      .send({ action: 'on_my_way' });
    expect(onMyWayRes.status).toBe(200);
    expect(onMyWayRes.body.incident_status).toBe('RESPONDING');

    await new Promise((r) => setTimeout(r, 60));

    // Verify owner GET /api/incidents/:id and owner WebSocket payloads reveal NOTHING about contact activity and are structurally IDENTICAL to genuine cancel!
    const ownerGet = await owner.get(`/api/incidents/${incidentId}`);
    expect(ownerGet.status).toBe(200);
    expect(ownerGet.body.incident.status).toBe('CANCELLED');
    expect(ownerGet.body.incident.is_duress).toBe(false);
    expect(normalizeOwnerCancelPayload(ownerGet.body)).toEqual(
      normalizeOwnerCancelPayload(genuineGetRes.body)
    );
    const ownerVisibleContactEvents = (
      ownerGet.body.incident.events || []
    ).filter((e: any) => e.actor_type === 'contact');
    expect(ownerVisibleContactEvents).toHaveLength(0);

    for (const msg of ownerWsMessages) {
      if (msg.incident && msg.incident.status === 'CANCELLED') {
        expect(msg.incident.is_duress).toBe(false);
        const leakedEvents = (msg.incident.events || []).filter(
          (e: any) => e.actor_type === 'contact'
        );
        expect(leakedEvents).toHaveLength(0);
      }
    }

    // 4. Contact taps "She is safe (close alert)" (`confirm_safe`) -> truly closes the duress incident to RESOLVED!
    const confirmSafeDuress = await request(baseUrl)
      .post(`/api/c/${rawToken}/respond`)
      .send({ action: 'confirm_safe' });
    expect(confirmSafeDuress.status).toBe(200);
    expect(confirmSafeDuress.body.incident_status).toBe('RESOLVED');
    expect(confirmSafeDuress.body.closed).toBe(true);

    const responderGetAfter = await responder.get(
      `/api/incidents/${incidentId}`
    );
    expect(responderGetAfter.status).toBe(200);
    expect(responderGetAfter.body.incident.status).toBe('RESOLVED');
    expect(responderGetAfter.body.incident.closed_at).toBeTruthy();

    ownerWs.close();
  });
});
