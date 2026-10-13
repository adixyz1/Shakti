import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../server';
import { closeDatabase, getDb, initDatabase } from '../core/db';
import { resetRateLimiter } from '../core/middleware';
import { seedDatabase } from '../core/seed';
import {
  DEFAULT_ORGANIZATION_ZONE,
  incidentAccessAudit,
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

describe('SAATHI Phase 6B API & End-to-End Integration Tests (Responder Routing, RBAC, Duress Safety & Audit Log)', () => {
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
      `saathi-phase6b-test-${crypto.randomUUID()}.db`
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
      .send({ phone_e164: phone, code: otpRes.body.dev_mock_hint, name });
    return {
      agent,
      user: verifyRes.body,
      userId: verifyRes.body.id as string,
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

  it('1. Routing & RBAC: routes ACTIVE incident to active on-duty responders in user organization, notifies via PushProvider at t=0, blocks role=user with 403, and isolates responders in other organizations', async () => {
    const owner = await loginPhone('+919000000001'); // Demo Campus Zone user
    const campusResponder = await loginPhone('+919000000002'); // Demo Campus Zone responder (Inspector Kavita Rao)
    const otherZoneResponderLogin = await loginPhone(
      '+919000000022',
      'Officer Vikram'
    );

    const db = getDb();
    // Promote +919000000022 to responder in a DIFFERENT organization ("North Sector Zone")
    await db
      .update(users)
      .set({
        role: 'responder',
        organizationZone: 'North Sector Zone',
      })
      .where(eq(users.id, otherZoneResponderLogin.userId));

    await db.insert(responders).values({
      id: crypto.randomUUID(),
      userId: otherZoneResponderLogin.userId,
      organizationZone: 'North Sector Zone',
      active: true,
      onDuty: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Re-login otherZoneResponder so JWT cookie has role=responder
    const otherZoneResponder = await loginPhone('+919000000022');

    // Also add an off-duty responder in Demo Campus Zone -> should NOT be routed
    const offDutyLogin = await loginPhone('+919000000023', 'Officer OffDuty');
    await db
      .update(users)
      .set({
        role: 'responder',
        organizationZone: DEFAULT_ORGANIZATION_ZONE,
      })
      .where(eq(users.id, offDutyLogin.userId));
    await db.insert(responders).values({
      id: crypto.randomUUID(),
      userId: offDutyLogin.userId,
      organizationZone: DEFAULT_ORGANIZATION_ZONE,
      active: true,
      onDuty: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // 1. Verify role=user cannot access /api/responder/incidents (403)
    const userAccessRes = await owner.agent.get('/api/responder/incidents');
    expect(userAccessRes.status).toBe(403);

    // 2. Owner triggers an incident and it becomes ACTIVE
    await owner.agent.post('/api/consents').send({
      type: 'location',
      granted: true,
      source: 'consent_center',
    });

    const createRes = await owner.agent.post('/api/incidents').send({
      client_request_id: 'req-6b-routing-rbac-1',
      emergency_type: 'stalking',
      location: { lat: 28.6139, lng: 77.209, accuracy_m: 9 },
    });
    const incidentId = createRes.body.incident.id;
    clearAllScheduledTimers();

    await activateAndDispatchIncident(incidentId, db, {
      step1DelayMs: 60_000,
      step2DelayMs: 120_000,
    });

    // Verify incident_assignments row created ONLY for active, on-duty responder in Demo Campus Zone
    const assignments = await db
      .select()
      .from(incidentAssignments)
      .where(eq(incidentAssignments.incidentId, incidentId));
    expect(assignments).toHaveLength(1);
    expect(assignments[0].responderUserId).toBe(campusResponder.userId);
    expect(assignments[0].organizationZone).toBe(DEFAULT_ORGANIZATION_ZONE);

    // Verify PushProvider sent push notification to campusResponder at t=0
    const responderPushes = defaultPushProvider.sentPushes.filter(
      (p) => p.recipientRef === campusResponder.userId
    );
    expect(responderPushes).toHaveLength(1);
    expect(responderPushes[0].title).toContain(DEFAULT_ORGANIZATION_ZONE);

    // 3. Campus responder sees the incident in GET /api/responder/incidents
    const campusListRes = await campusResponder.agent.get(
      '/api/responder/incidents'
    );
    expect(campusListRes.status).toBe(200);
    expect(campusListRes.body.incidents).toHaveLength(1);
    expect(campusListRes.body.incidents[0].id).toBe(incidentId);
    expect(campusListRes.body.incidents[0].user_first_name).toBe('Aarohi');

    // 4. Other zone responder sees 0 incidents in list and gets 403 on detail & actions
    const otherListRes = await otherZoneResponder.agent.get(
      '/api/responder/incidents'
    );
    expect(otherListRes.status).toBe(200);
    expect(otherListRes.body.incidents).toHaveLength(0);

    const otherDetailRes = await otherZoneResponder.agent.get(
      `/api/responder/incidents/${incidentId}`
    );
    expect(otherDetailRes.status).toBe(403);

    const otherAckRes = await otherZoneResponder.agent
      .post(`/api/responder/incidents/${incidentId}/acknowledge`)
      .send({});
    expect(otherAckRes.status).toBe(403);
  });

  it('2. Minimal Exposure & Consent-Gated Location: responder sees first name only, phone ONLY after acknowledging, no consent ledger or other contacts details, and location ONLY when location consent is active', async () => {
    const owner = await loginPhone('+919000000001');
    const responder = await loginPhone('+919000000002');
    const c1 = await createAndAcceptContact(
      owner.agent,
      'Secret Contact Priya',
      '+919800000077'
    );

    // Initially grant location consent and create incident with sample
    await owner.agent.post('/api/consents').send({
      type: 'location',
      granted: true,
      source: 'consent_center',
    });

    const createRes = await owner.agent.post('/api/incidents').send({
      client_request_id: 'req-6b-minimal-exposure-2',
      emergency_type: 'medical',
      location: { lat: 19.076, lng: 72.8777, accuracy_m: 11 },
    });
    const incidentId = createRes.body.incident.id;
    clearAllScheduledTimers();

    const db = getDb();
    await activateAndDispatchIncident(incidentId, db, {
      step1DelayMs: 60_000,
      step2DelayMs: 120_000,
    });

    // Have the contact respond via magic link so there is a contact event in the timeline
    const allSms = await db.select().from(sentMessages);
    const smsMsg = allSms.find((m) => m.toPhoneE164 === '+919800000077')!;
    const token = String((smsMsg.metadata as any)?.token);
    await request(app)
      .post(`/api/c/${token}/respond`)
      .send({ action: 'cannot_help' });

    // BEFORE responder acknowledges:
    // - user_first_name is 'Aarohi' (not full name 'Aarohi Sharma')
    // - user_phone_e164 is null (hidden before acknowledge)
    // - latest_location is present because location consent is active
    // - no consent ledger or trusted contact name/phone/id is leaked
    const detailBeforeAck = await responder.agent.get(
      `/api/responder/incidents/${incidentId}`
    );
    expect(detailBeforeAck.status).toBe(200);
    const incBefore = detailBeforeAck.body.incident;
    expect(incBefore.user_first_name).toBe('Aarohi');
    expect(incBefore.user_phone_e164).toBeNull();
    expect(incBefore.acknowledged_by_responder).toBe(false);
    expect(incBefore.latest_location).toBeDefined();
    expect(incBefore.latest_location.lat).toBeCloseTo(19.076, 4);

    const rawJsonBefore = JSON.stringify(incBefore);
    expect(rawJsonBefore).not.toContain('Secret Contact Priya');
    expect(rawJsonBefore).not.toContain('+919800000077');
    expect(rawJsonBefore).not.toContain(c1.id);
    expect(incBefore.consents).toBeUndefined();
    expect(incBefore.contacts).toBeUndefined();

    // Now revoke location consent -> responder detail must omit latest_location immediately
    await owner.agent.post('/api/consents').send({
      type: 'location',
      granted: false,
      source: 'consent_center',
    });

    const detailNoLoc = await responder.agent.get(
      `/api/responder/incidents/${incidentId}`
    );
    expect(detailNoLoc.status).toBe(200);
    expect(detailNoLoc.body.incident.latest_location).toBeNull();

    // Responder acknowledges -> escalation stops, status becomes ACKNOWLEDGED, and user_phone_e164 is now revealed!
    expect(hasScheduledEscalation(incidentId)).toBe(true);
    const ackRes = await responder.agent
      .post(`/api/responder/incidents/${incidentId}/acknowledge`)
      .send({ note: 'Campus patrol unit 1 acknowledging' });
    expect(ackRes.status).toBe(200);
    expect(ackRes.body.incident.status).toBe('ACKNOWLEDGED');
    expect(ackRes.body.incident.acknowledged_by_responder).toBe(true);
    expect(ackRes.body.incident.user_phone_e164).toBe('+919000000001');
    expect(hasScheduledEscalation(incidentId)).toBe(false);
  });

  it('3. Responder Actions & State Machine: assign, note, responding, resolve, and false-alarm (requires note) write responder events and transition state', async () => {
    const owner = await loginPhone('+919000000001');
    const responder = await loginPhone('+919000000002');

    const createRes = await owner.agent.post('/api/incidents').send({
      client_request_id: 'req-6b-actions-state-machine-3',
    });
    const incidentId = createRes.body.incident.id;
    clearAllScheduledTimers();

    const db = getDb();
    await activateAndDispatchIncident(incidentId, db, {
      step1DelayMs: 60_000,
      step2DelayMs: 120_000,
    });

    // 1. Assign responder
    const assignRes = await responder.agent
      .post(`/api/responder/incidents/${incidentId}/assign`)
      .send({
        target_responder_user_id: responder.userId,
        note: 'Assigned to Inspector Kavita Rao',
      });
    expect(assignRes.status).toBe(200);

    // 2. Add operational note
    const noteRes = await responder.agent
      .post(`/api/responder/incidents/${incidentId}/note`)
      .send({ note: 'Dispatched security van towards Main Gate' });
    expect(noteRes.status).toBe(200);
    expect(
      noteRes.body.incident.events.some(
        (e: any) =>
          e.actor_type === 'responder' &&
          String(e.note).includes('Dispatched security van')
      )
    ).toBe(true);

    // 3. Mark responding -> transitions to RESPONDING
    const respRes = await responder.agent
      .post(`/api/responder/incidents/${incidentId}/responding`)
      .send({ note: 'Patrol unit arriving in 2 mins' });
    expect(respRes.status).toBe(200);
    expect(respRes.body.incident.status).toBe('RESPONDING');

    // 4. False alarm without note -> 422
    const badFalseAlarm = await responder.agent
      .post(`/api/responder/incidents/${incidentId}/false-alarm`)
      .send({ note: '   ' });
    expect(badFalseAlarm.status).toBe(422);

    // 5. Resolve incident -> transitions to RESOLVED
    const resolveRes = await responder.agent
      .post(`/api/responder/incidents/${incidentId}/resolve`)
      .send({ note: 'Met student at Hostel Gate; confirmed safe' });
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.incident.status).toBe('RESOLVED');

    // 6. Test false-alarm transition on a second incident with a required note
    const createRes2 = await owner.agent.post('/api/incidents').send({
      client_request_id: 'req-6b-false-alarm-test',
    });
    const inc2Id = createRes2.body.incident.id;
    clearAllScheduledTimers();
    await activateAndDispatchIncident(inc2Id, db, {
      step1DelayMs: 60_000,
      step2DelayMs: 120_000,
    });

    const falseAlarmRes = await responder.agent
      .post(`/api/responder/incidents/${inc2Id}/false-alarm`)
      .send({ note: 'Accidental button press confirmed in person' });
    expect(falseAlarmRes.status).toBe(200);
    expect(falseAlarmRes.body.incident.status).toBe('FALSE_ALARM');
  });

  it('4. End-to-End Integration (Genuine + Duress) & Audit Log: user triggers -> contact notified -> responder sees it -> responder acknowledges (timer stops, owner status updates for genuine and stays masked for duress) -> audit log records all non-owner accesses', async () => {
    const owner = await loginPhone('+919000000001');
    const responder = await loginPhone('+919000000002');
    const admin = await loginPhone('+919000000003');

    await createAndAcceptContact(owner.agent, 'Priya', '+919800000088');
    await owner.agent.post('/api/consents').send({
      type: 'location',
      granted: true,
      source: 'consent_center',
    });

    // --- PART A: Genuine Incident End-to-End ---
    const genuineCreate = await owner.agent.post('/api/incidents').send({
      client_request_id: 'req-6b-e2e-genuine',
      emergency_type: 'unsafe_ride',
      location: { lat: 28.545, lng: 77.192, accuracy_m: 8 },
    });
    const genuineId = genuineCreate.body.incident.id;
    clearAllScheduledTimers();

    const db = getDb();
    await activateAndDispatchIncident(genuineId, db, {
      step1DelayMs: 60_000,
      step2DelayMs: 120_000,
    });
    expect(hasScheduledEscalation(genuineId)).toBe(true);

    // Contact opens magic link
    const allSms = await db.select().from(sentMessages);
    const genuineSms = allSms.find(
      (m) =>
        m.toPhoneE164 === '+919800000088' &&
        (m.metadata as any)?.incident_id === genuineId
    )!;
    const genuineToken = String((genuineSms.metadata as any)?.token);
    const contactOpenRes = await request(app).get(`/api/c/${genuineToken}`);
    expect(contactOpenRes.status).toBe(200);

    // Responder sees incident in dashboard list and acknowledges
    const responderAckGenuine = await responder.agent
      .post(`/api/responder/incidents/${genuineId}/acknowledge`)
      .send({ note: 'Responder on the way' });
    expect(responderAckGenuine.status).toBe(200);
    expect(responderAckGenuine.body.incident.status).toBe('ACKNOWLEDGED');

    // Escalation timer stopped
    expect(hasScheduledEscalation(genuineId)).toBe(false);

    // Owner's status updates to ACKNOWLEDGED for genuine incident
    const ownerGenuineView = await owner.agent.get(
      `/api/incidents/${genuineId}`
    );
    expect(ownerGenuineView.status).toBe(200);
    expect(ownerGenuineView.body.incident.status).toBe('ACKNOWLEDGED');

    // Resolve genuine incident so we can test duress incident
    await responder.agent
      .post(`/api/responder/incidents/${genuineId}/resolve`)
      .send({ note: 'Resolved genuine incident' });

    // --- PART B: Duress Incident End-to-End ---
    await owner.agent.put('/api/settings/cancel-pin').send({ pin: '1234' });
    await owner.agent.put('/api/settings/duress-pin').send({ pin: '9999' });

    const duressCreate = await owner.agent.post('/api/incidents').send({
      client_request_id: 'req-6b-e2e-duress',
      emergency_type: 'domestic_violence',
      location: { lat: 28.546, lng: 77.193, accuracy_m: 10 },
    });
    const duressId = duressCreate.body.incident.id;

    // Owner supplies duress PIN -> owner sees CANCELLED
    const duressCancelRes = await owner.agent
      .post(`/api/incidents/${duressId}/cancel`)
      .send({ pin: '9999' });
    expect(duressCancelRes.status).toBe(200);
    expect(duressCancelRes.body.incident.status).toBe('CANCELLED');
    expect(duressCancelRes.body.incident.is_duress).toBe(false);

    clearAllScheduledTimers();
    await activateAndDispatchIncident(duressId, db, {
      step1DelayMs: 60_000,
      step2DelayMs: 120_000,
    });
    expect(hasScheduledEscalation(duressId)).toBe(true);

    // Responder views duress incident -> sees real status NOTIFIED, is_duress = true, and duress_notice
    const responderDuressDetail = await responder.agent.get(
      `/api/responder/incidents/${duressId}`
    );
    expect(responderDuressDetail.status).toBe(200);
    expect(responderDuressDetail.body.incident.status).toBe('NOTIFIED');
    expect(responderDuressDetail.body.incident.is_duress).toBe(true);
    expect(responderDuressDetail.body.incident.duress_notice).toBe(
      DURESS_SAFETY_NOTICE_EN
    );

    // Responder acknowledges and marks responding on duress incident -> timer stops
    await responder.agent
      .post(`/api/responder/incidents/${duressId}/acknowledge`)
      .send({ note: 'Silent duress acknowledgement' });
    expect(hasScheduledEscalation(duressId)).toBe(false);

    await responder.agent
      .post(`/api/responder/incidents/${duressId}/responding`)
      .send({ note: 'Silent dispatch to location' });

    // Owner's payload stays masked as CANCELLED with zero responder events visible
    const ownerDuressView = await owner.agent.get(`/api/incidents/${duressId}`);
    expect(ownerDuressView.status).toBe(200);
    expect(ownerDuressView.body.incident.status).toBe('CANCELLED');
    expect(ownerDuressView.body.incident.is_duress).toBe(false);
    expect(
      ownerDuressView.body.incident.events.some(
        (e: any) => e.actor_type === 'responder'
      )
    ).toBe(false);

    // --- PART C: Audit Log Verification (Admin-only endpoint) ---
    // Non-admin (user and responder) cannot read /api/admin/audit-logs (403)
    const userAuditRes = await owner.agent.get('/api/admin/audit-logs');
    expect(userAuditRes.status).toBe(403);
    const responderAuditRes = await responder.agent.get(
      '/api/admin/audit-logs'
    );
    expect(responderAuditRes.status).toBe(403);

    // Admin reads audit log -> contains contact_link_open, responder_view_incident, and responder_action:*
    const adminAuditRes = await admin.agent.get('/api/admin/audit-logs');
    expect(adminAuditRes.status).toBe(200);
    const entries = adminAuditRes.body.entries;
    expect(entries.length).toBeGreaterThanOrEqual(4);

    const actionsRecorded = entries.map((e: any) => e.action);
    expect(actionsRecorded).toContain('contact_link_open');
    expect(actionsRecorded).toContain('responder_view_incident');
    expect(actionsRecorded).toContain('responder_action:acknowledge');
    expect(actionsRecorded).toContain('responder_action:responding');
  });
});
