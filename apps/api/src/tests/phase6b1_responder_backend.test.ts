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
  auditLog,
  DEFAULT_ORGANIZATION_ZONE,
  incidentAssignments,
  incidents,
  responders,
  sentMessages,
  users,
} from '../db/schema';
import { defaultEmergencyGateway } from '../providers/emergencyGateway';
import { defaultPushProvider } from '../providers/push';
import { defaultSmsProvider } from '../providers/sms';
import { DURESS_SAFETY_NOTICE_EN } from '../services/contactIncidentTokenService';
import {
  activateAndDispatchIncident,
  clearAllScheduledTimers,
  hasScheduledEscalation,
} from '../services/scheduler';

describe('SAATHI Phase 6B-1 Backend Tests (Responder Routing, RBAC, Duress Rules & Audit Log)', () => {
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
      `saathi-phase6b1-test-${crypto.randomUUID()}.db`
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
    resetRateLimiter();
    const agent = request.agent(app);
    agent.set('Origin', 'http://localhost:3000');
    const otpRes = await agent
      .post('/api/auth/otp/request')
      .send({ phone_e164: phone });
    const verifyRes = await agent
      .post('/api/auth/otp/verify')
      .send({ phone_e164: phone, code: otpRes.body.dev_mock_hint, name });
    const setCookieHeader = verifyRes.headers['set-cookie'];
    return {
      agent,
      user: verifyRes.body,
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

  it('1. Organization routing & RBAC: responders see only their organization incidents (open first) and are notified via PushProvider; other roles (user/admin) are rejected', async () => {
    const owner = await loginPhone('+919000000001'); // Demo Campus Zone user
    const demoResponder = await loginPhone('+919000000002'); // Demo Campus Zone responder
    const admin = await loginPhone('+919000000003'); // Admin

    const db = getDb();

    // Create a second responder in a different organization ("South Campus")
    const otherLogin = await loginPhone('+919000000044', 'Officer South');
    await db
      .update(users)
      .set({
        role: 'responder',
        organization: 'South Campus',
        organizationZone: 'South Campus',
      })
      .where(eq(users.id, otherLogin.userId));
    await db.insert(responders).values({
      id: crypto.randomUUID(),
      userId: otherLogin.userId,
      organization: 'South Campus',
      organizationZone: 'South Campus',
      active: true,
      onDuty: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const otherResponder = await loginPhone('+919000000044');

    // Create an off-duty responder in Demo Campus Zone -> must NOT be assigned or notified
    const offDutyLogin = await loginPhone('+919000000045', 'Officer OffDuty');
    await db
      .update(users)
      .set({
        role: 'responder',
        organization: DEFAULT_ORGANIZATION_ZONE,
        organizationZone: DEFAULT_ORGANIZATION_ZONE,
      })
      .where(eq(users.id, offDutyLogin.userId));
    await db.insert(responders).values({
      id: crypto.randomUUID(),
      userId: offDutyLogin.userId,
      organization: DEFAULT_ORGANIZATION_ZONE,
      organizationZone: DEFAULT_ORGANIZATION_ZONE,
      active: true,
      onDuty: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Non-responder roles (user and admin) are rejected from /api/responder/incidents
    expect((await owner.agent.get('/api/responder/incidents')).status).toBe(403);
    expect((await admin.agent.get('/api/responder/incidents')).status).toBe(403);

    // Trigger incident 1 -> activate -> resolve (closed)
    const inc1Create = await owner.agent.post('/api/incidents').send({
      client_request_id: 'req-6b1-inc-closed',
      emergency_type: 'harassment',
    });
    const closedIncId = inc1Create.body.incident.id;
    clearAllScheduledTimers();
    await activateAndDispatchIncident(closedIncId, db, {
      step1DelayMs: 60_000,
      step2DelayMs: 120_000,
    });
    await demoResponder.agent
      .post(`/api/responder/incidents/${closedIncId}/resolve`)
      .send({ note: 'Resolved first incident' });

    // Trigger incident 2 -> activate (open)
    defaultPushProvider.reset();
    const inc2Create = await owner.agent.post('/api/incidents').send({
      client_request_id: 'req-6b1-inc-open',
      emergency_type: 'stalking',
    });
    const openIncId = inc2Create.body.incident.id;
    clearAllScheduledTimers();
    await activateAndDispatchIncident(openIncId, db, {
      step1DelayMs: 60_000,
      step2DelayMs: 120_000,
    });

    // Verify incident_assignments row created ONLY for active, on-duty responder of user's organization
    const assigns = await db
      .select()
      .from(incidentAssignments)
      .where(eq(incidentAssignments.incidentId, openIncId));
    expect(assigns).toHaveLength(1);
    expect(assigns[0].responderUserId).toBe(demoResponder.userId);
    expect(assigns[0].acknowledgedAt).toBeNull();

    // Verify mock PushProvider notified only the active, on-duty responder in Demo Campus Zone
    expect(
      defaultPushProvider.sentPushes.filter(
        (p) => p.recipientRef === demoResponder.userId
      )
    ).toHaveLength(1);
    expect(
      defaultPushProvider.sentPushes.filter(
        (p) => p.recipientRef === otherResponder.userId
      )
    ).toHaveLength(0);

    // Demo responder lists incidents -> sees both, open incident first
    const listRes = await demoResponder.agent.get('/api/responder/incidents');
    expect(listRes.status).toBe(200);
    expect(listRes.body.incidents).toHaveLength(2);
    expect(listRes.body.incidents[0].id).toBe(openIncId);
    expect(listRes.body.incidents[1].id).toBe(closedIncId);

    // Responder in other organization sees 0 incidents and is rejected on detail/action
    const otherListRes = await otherResponder.agent.get(
      '/api/responder/incidents'
    );
    expect(otherListRes.status).toBe(200);
    expect(otherListRes.body.incidents).toHaveLength(0);
    expect(
      (await otherResponder.agent.get(`/api/responder/incidents/${openIncId}`))
        .status
    ).toBe(403);
    expect(
      (
        await otherResponder.agent
          .post(`/api/responder/incidents/${openIncId}/acknowledge`)
          .send({})
      ).status
    ).toBe(403);
  });

  it('2. Privacy & Consent Gating: phone hidden until acknowledge, location hidden without location consent, no consent ledger or other contacts details exposed', async () => {
    const owner = await loginPhone('+919000000001');
    const responder = await loginPhone('+919000000002');
    const contact = await createAndAcceptContact(
      owner.agent,
      'Confidential Contact Neha',
      '+919800000055'
    );

    // Grant location consent initially
    await owner.agent.post('/api/consents').send({
      type: 'location',
      granted: true,
      source: 'consent_center',
    });

    const createRes = await owner.agent.post('/api/incidents').send({
      client_request_id: 'req-6b1-privacy-consent',
      emergency_type: 'medical',
      location: { lat: 28.6139, lng: 77.209, accuracy_m: 7 },
    });
    const incidentId = createRes.body.incident.id;
    clearAllScheduledTimers();

    const db = getDb();
    await activateAndDispatchIncident(incidentId, db, {
      step1DelayMs: 60_000,
      step2DelayMs: 120_000,
    });

    // Contact responds so there is a contact event in timeline
    const allSms = await db.select().from(sentMessages);
    const smsMsg = allSms.find((m) => m.toPhoneE164 === '+919800000055')!;
    const token = String((smsMsg.metadata as any)?.token);
    await request(app)
      .post(`/api/c/${token}/respond`)
      .send({ action: 'cannot_help' });

    // Before acknowledge: phone is null, first name only, location present, no contact details or consent ledger
    const beforeAck = await responder.agent.get(
      `/api/responder/incidents/${incidentId}`
    );
    expect(beforeAck.status).toBe(200);
    const detail1 = beforeAck.body.incident;
    expect(detail1.user_first_name).toBe('Aarohi');
    expect(detail1.user_phone_e164).toBeNull();
    expect(detail1.latest_location).not.toBeNull();
    expect(detail1.latest_location.lat).toBeCloseTo(28.6139, 4);
    expect(detail1.consents).toBeUndefined();
    expect(detail1.contacts).toBeUndefined();
    const rawStr = JSON.stringify(detail1);
    expect(rawStr).not.toContain('Confidential Contact Neha');
    expect(rawStr).not.toContain('+919800000055');
    expect(rawStr).not.toContain(contact.id);

    // Revoke location consent -> location is immediately hidden (null)
    await owner.agent.post('/api/consents').send({
      type: 'location',
      granted: false,
      source: 'consent_center',
    });

    const noConsentRes = await responder.agent.get(
      `/api/responder/incidents/${incidentId}`
    );
    expect(noConsentRes.status).toBe(200);
    expect(noConsentRes.body.incident.latest_location).toBeNull();

    // Acknowledge -> stops escalation, sets acknowledged_at, and reveals phone
    expect(hasScheduledEscalation(incidentId)).toBe(true);
    const ackRes = await responder.agent
      .post(`/api/responder/incidents/${incidentId}/acknowledge`)
      .send({ note: 'Acknowledged by patrol' });
    expect(ackRes.status).toBe(200);
    expect(ackRes.body.incident.status).toBe('ACKNOWLEDGED');
    expect(ackRes.body.incident.user_phone_e164).toBe('+919000000001');
    expect(ackRes.body.incident.assignments[0].acknowledged_at).toBeTruthy();
    expect(hasScheduledEscalation(incidentId)).toBe(false);
  });

  it('3. Actions & State Machine: acknowledge, responding, note, resolve, and false-alarm write responder events and respect state machine transitions', async () => {
    const owner = await loginPhone('+919000000001');
    const responder = await loginPhone('+919000000002');
    const db = getDb();

    const create1 = await owner.agent.post('/api/incidents').send({
      client_request_id: 'req-6b1-actions-1',
    });
    const inc1Id = create1.body.incident.id;
    clearAllScheduledTimers();
    await activateAndDispatchIncident(inc1Id, db, {
      step1DelayMs: 60_000,
      step2DelayMs: 120_000,
    });

    // 1. acknowledge -> ACKNOWLEDGED + stops escalation
    expect(hasScheduledEscalation(inc1Id)).toBe(true);
    const ackRes = await responder.agent
      .post(`/api/responder/incidents/${inc1Id}/acknowledge`)
      .send({ note: 'Responder acknowledged' });
    expect(ackRes.status).toBe(200);
    expect(ackRes.body.incident.status).toBe('ACKNOWLEDGED');
    expect(hasScheduledEscalation(inc1Id)).toBe(false);

    // 2. responding -> RESPONDING
    const respRes = await responder.agent
      .post(`/api/responder/incidents/${inc1Id}/responding`)
      .send({ note: 'En route to campus gate' });
    expect(respRes.status).toBe(200);
    expect(respRes.body.incident.status).toBe('RESPONDING');

    // 3. note -> writes responder event without changing status
    const noteRes = await responder.agent
      .post(`/api/responder/incidents/${inc1Id}/note`)
      .send({ note: 'Spoke with gate security' });
    expect(noteRes.status).toBe(200);
    expect(noteRes.body.incident.status).toBe('RESPONDING');
    expect(
      noteRes.body.incident.events.some(
        (e: any) =>
          e.actor_type === 'responder' &&
          e.note === 'Spoke with gate security'
      )
    ).toBe(true);

    // 4. resolve -> RESOLVED
    const resolveRes = await responder.agent
      .post(`/api/responder/incidents/${inc1Id}/resolve`)
      .send({ note: 'Student escorted safely' });
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.incident.status).toBe('RESOLVED');

    // Transition on already-closed incident is rejected (400)
    const postAfterClose = await responder.agent
      .post(`/api/responder/incidents/${inc1Id}/responding`)
      .send({ note: 'Should fail' });
    expect(postAfterClose.status).toBe(400);

    // 5. false-alarm on a second open incident -> transitions to FALSE_ALARM
    const create2 = await owner.agent.post('/api/incidents').send({
      client_request_id: 'req-6b1-actions-2',
    });
    const inc2Id = create2.body.incident.id;
    clearAllScheduledTimers();
    await activateAndDispatchIncident(inc2Id, db, {
      step1DelayMs: 60_000,
      step2DelayMs: 120_000,
    });

    const falseAlarmRes = await responder.agent
      .post(`/api/responder/incidents/${inc2Id}/false-alarm`)
      .send({ note: 'Verified accidental trigger with student' });
    expect(falseAlarmRes.status).toBe(200);
    expect(falseAlarmRes.body.incident.status).toBe('FALSE_ALARM');
  });

  it('4. Duress Rules & Audit Log: owner of a duress incident sees nothing about responder actions; responder resolve truly closes duress; audit_log records responder list/view/actions and contact link opens (admin-only)', async () => {
    const owner = await loginPhone('+919000000001');
    const responder = await loginPhone('+919000000002');
    const admin = await loginPhone('+919000000003');
    const db = getDb();

    await createAndAcceptContact(owner.agent, 'Priya', '+919800000099');
    await owner.agent.put('/api/settings/cancel-pin').send({ pin: '1234' });
    await owner.agent.put('/api/settings/duress-pin').send({ pin: '9999' });

    const createRes = await owner.agent.post('/api/incidents').send({
      client_request_id: 'req-6b1-duress-audit',
      emergency_type: 'domestic_violence',
    });
    const duressId = createRes.body.incident.id;

    // Owner enters duress PIN -> owner sees CANCELLED
    const cancelRes = await owner.agent
      .post(`/api/incidents/${duressId}/cancel`)
      .send({ pin: '9999' });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.incident.status).toBe('CANCELLED');
    expect(cancelRes.body.incident.is_duress).toBe(false);

    clearAllScheduledTimers();
    await activateAndDispatchIncident(duressId, db, {
      step1DelayMs: 60_000,
      step2DelayMs: 120_000,
    });

    // Contact opens magic link (hooked into audit_log)
    const allSms = await db.select().from(sentMessages);
    const smsMsg = allSms.find(
      (m) =>
        m.toPhoneE164 === '+919800000099' &&
        (m.metadata as any)?.incident_id === duressId
    )!;
    const contactToken = String((smsMsg.metadata as any)?.token);
    const contactGetRes = await request(app).get(`/api/c/${contactToken}`);
    expect(contactGetRes.status).toBe(200);

    // Responder lists, views, acknowledges, and marks responding on the duress incident
    await responder.agent.get('/api/responder/incidents');
    const detailRes = await responder.agent.get(
      `/api/responder/incidents/${duressId}`
    );
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.incident.is_duress).toBe(true);
    expect(detailRes.body.incident.duress_notice).toBe(DURESS_SAFETY_NOTICE_EN);
    expect(detailRes.body.incident.status).toBe('NOTIFIED');

    // Connect owner WebSocket to verify WebSocket messages also stay masked during responder actions
    const server = http.createServer(app);
    attachWebSocketServer(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const ownerWsMessages: any[] = [];
    const ownerWs = new WebSocket(
      `ws://127.0.0.1:${port}/ws/incidents/${duressId}`,
      { headers: { Cookie: owner.cookies } }
    );
    await new Promise<void>((resolve, reject) => {
      ownerWs.on('open', () => resolve());
      ownerWs.on('error', reject);
    });
    ownerWs.on('message', (raw) => {
      ownerWsMessages.push(JSON.parse(String(raw)));
    });

    await responder.agent
      .post(`/api/responder/incidents/${duressId}/acknowledge`)
      .send({ note: 'Silent duress acknowledge' });
    await responder.agent
      .post(`/api/responder/incidents/${duressId}/responding`)
      .send({ note: 'Silent duress responding' });
    await responder.agent
      .post(`/api/responder/incidents/${duressId}/note`)
      .send({ note: 'Silent duress note' });

    // Owner of the duress incident still sees CANCELLED and zero responder events on REST and WebSocket
    const ownerCheck = await owner.agent.get(`/api/incidents/${duressId}`);
    expect(ownerCheck.status).toBe(200);
    expect(ownerCheck.body.incident.status).toBe('CANCELLED');
    expect(ownerCheck.body.incident.is_duress).toBe(false);
    expect(
      ownerCheck.body.incident.events.some(
        (e: any) => e.actor_type === 'responder'
      )
    ).toBe(false);

    for (const msg of ownerWsMessages) {
      if (msg.incident) {
        expect(msg.incident.status).toBe('CANCELLED');
        expect(msg.incident.is_duress).toBe(false);
        expect(
          (msg.incident.events || []).some(
            (e: any) => e.actor_type === 'responder'
          )
        ).toBe(false);
      }
    }

    ownerWs.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));

    // Responder resolve truly closes the duress incident in the database
    const resolveDuress = await responder.agent
      .post(`/api/responder/incidents/${duressId}/resolve`)
      .send({ note: 'Confirmed safe in person; closing duress incident' });
    expect(resolveDuress.status).toBe(200);
    expect(resolveDuress.body.incident.status).toBe('RESOLVED');

    const [dbIncAfterResolve] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, duressId));
    expect(dbIncAfterResolve.status).toBe('RESOLVED');
    expect(dbIncAfterResolve.closedAt).toBeTruthy();

    // Audit log endpoint is admin-only
    expect((await owner.agent.get('/api/admin/audit-log')).status).toBe(403);
    expect((await responder.agent.get('/api/admin/audit-log')).status).toBe(403);

    // Admin fetches GET /api/admin/audit-log and filters by actor_type / incident_id
    const auditAllRes = await admin.agent.get('/api/admin/audit-log');
    expect(auditAllRes.status).toBe(200);
    const allActions = auditAllRes.body.entries.map((e: any) => e.action);
    expect(allActions).toContain('contact_link_open');
    expect(allActions).toContain('responder_list_incidents');
    expect(allActions).toContain('responder_view_incident');
    expect(allActions).toContain('responder_action:acknowledge');
    expect(allActions).toContain('responder_action:responding');
    expect(allActions).toContain('responder_action:note');
    expect(allActions).toContain('responder_action:resolve');

    const contactOnlyAudit = await admin.agent.get(
      `/api/admin/audit-log?actor_type=contact&incident_id=${duressId}`
    );
    expect(contactOnlyAudit.status).toBe(200);
    expect(contactOnlyAudit.body.entries).toHaveLength(1);
    expect(contactOnlyAudit.body.entries[0].action).toBe('contact_link_open');

    // Verify rows exist directly in the SQLite `audit_log` table
    const dbAuditRows = await db.select().from(auditLog);
    expect(dbAuditRows.length).toBeGreaterThanOrEqual(7);
  });
});
