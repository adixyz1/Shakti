import { defaultOtpProvider } from '../providers/otp';
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
import { notifications, sentMessages } from '../db/schema';
import { defaultEmergencyGateway } from '../providers/emergencyGateway';
import { defaultPushProvider } from '../providers/push';
import { defaultSmsProvider } from '../providers/sms';
import {
  activateAndDispatchIncident,
  clearAllScheduledTimers,
  hasScheduledEscalation,
} from '../services/scheduler';

describe('SAATHI Phase 6B Verification Gap Tests (API)', () => {
  let tempDbPath: string;
  const app = createApp();

  beforeEach(async () => {
    process.env.DEMO_MODE = 'true';
    process.env.DEMO_ADMIN_HINT = 'true';
    clearAllScheduledTimers();
    resetRateLimiter();
    defaultPushProvider.reset();
    defaultSmsProvider.reset();
    defaultEmergencyGateway.reset();

    tempDbPath = path.join(
      os.tmpdir(),
      `saathi-phase6b-gaps-${crypto.randomUUID()}.db`
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
    return {
      agent,
      user: verifyRes.body,
      userId: verifyRes.body.id as string,
    };
  }

  it('1. Duress resolve & invalid transition rejection (e, h, q): responder resolve truly closes a duress incident while keeping owner view masked, rejects invalid state transitions after close, and includes MOCK 112 gateway status', async () => {
    const owner = await loginPhone('+919000000001');
    const responder = await loginPhone('+919000000002');

    await owner.agent.put('/api/settings/cancel-pin').send({ pin: '1234' });
    await owner.agent.put('/api/settings/duress-pin').send({ pin: '9999' });

    const createRes = await owner.agent.post('/api/incidents').send({
      client_request_id: 'req-6b-gap-duress-resolve',
      emergency_type: 'stalking',
    });
    const duressId = createRes.body.incident.id;

    // Enter duress PIN so incident is_duress = true and owner sees CANCELLED
    const cancelRes = await owner.agent
      .post(`/api/incidents/${duressId}/cancel`)
      .send({ pin: '9999' });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.incident.status).toBe('CANCELLED');

    clearAllScheduledTimers();
    const db = getDb();
    await activateAndDispatchIncident(duressId, db, {
      step1DelayMs: 60_000,
      step2DelayMs: 120_000,
    });

    // Responder views incident -> mock_112_gateway is present and labeled MOCK
    const detailRes = await responder.agent.get(
      `/api/responder/incidents/${duressId}`
    );
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.incident.mock_112_gateway).toBeDefined();
    expect(detailRes.body.incident.mock_112_gateway.is_mock).toBe(true);
    expect(detailRes.body.incident.mock_112_gateway.label).toBe('MOCK');

    // Responder resolves the duress incident -> truly closes it (status = RESOLVED, closed_at set)
    const resolveRes = await responder.agent
      .post(`/api/responder/incidents/${duressId}/resolve`)
      .send({ note: 'Responder verified safety silently and closed alert' });
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.incident.status).toBe('RESOLVED');
    expect(resolveRes.body.incident.closed_at).toBeTruthy();
    expect(
      resolveRes.body.incident.events.some(
        (ev: any) =>
          ev.actor_type === 'responder' && ev.to_status === 'RESOLVED'
      )
    ).toBe(true);

    // Owner still sees CANCELLED with no responder events leaked
    const ownerAfterResolve = await owner.agent.get(
      `/api/incidents/${duressId}`
    );
    expect(ownerAfterResolve.status).toBe(200);
    expect(ownerAfterResolve.body.incident.status).toBe('CANCELLED');
    expect(
      ownerAfterResolve.body.incident.events.some(
        (ev: any) => ev.actor_type === 'responder'
      )
    ).toBe(false);

    // Attempting an invalid transition (acknowledge or responding) on a RESOLVED incident is rejected (400)
    const invalidAckAfterClose = await responder.agent
      .post(`/api/responder/incidents/${duressId}/acknowledge`)
      .send({});
    expect(invalidAckAfterClose.status).toBe(400);

    const invalidRespAfterClose = await responder.agent
      .post(`/api/responder/incidents/${duressId}/responding`)
      .send({});
    expect(invalidRespAfterClose.status).toBe(400);
  });

  it('2. Audit log for responder list/view/actions & GET /api/admin/audit-log admin-only route (i, k)', async () => {
    const owner = await loginPhone('+919000000001');
    const responder = await loginPhone('+919000000002');
    const admin = await loginPhone('+919000000003');

    const createRes = await owner.agent.post('/api/incidents').send({
      client_request_id: 'req-6b-gap-audit-list',
    });
    const incidentId = createRes.body.incident.id;
    clearAllScheduledTimers();

    const db = getDb();
    await activateAndDispatchIncident(incidentId, db, {
      step1DelayMs: 60_000,
      step2DelayMs: 120_000,
    });

    // Responder lists, views, and acknowledges
    const listRes = await responder.agent.get('/api/responder/incidents');
    expect(listRes.status).toBe(200);

    const viewRes = await responder.agent.get(
      `/api/responder/incidents/${incidentId}`
    );
    expect(viewRes.status).toBe(200);

    const ackRes = await responder.agent
      .post(`/api/responder/incidents/${incidentId}/acknowledge`)
      .send({ note: 'Ack for audit test' });
    expect(ackRes.status).toBe(200);

    // Non-admins rejected on GET /api/admin/audit-log
    const userAudit = await owner.agent.get('/api/admin/audit-log');
    expect(userAudit.status).toBe(403);
    const respAudit = await responder.agent.get('/api/admin/audit-log');
    expect(respAudit.status).toBe(403);

    // Admin reads GET /api/admin/audit-log -> sees responder_list_incidents, responder_view_incident, responder_action:acknowledge
    const adminAudit = await admin.agent.get('/api/admin/audit-log');
    expect(adminAudit.status).toBe(200);
    const actions = adminAudit.body.entries.map((e: any) => e.action);
    expect(actions).toContain('responder_list_incidents');
    expect(actions).toContain('responder_view_incident');
    expect(actions).toContain('responder_action:acknowledge');
  });

  it('3. Follow-up 1: After a responder acknowledges, escalation timers for that incident are cancelled and no further escalation notifications or mock-112 request are sent', async () => {
    const owner = await loginPhone('+919000000001');
    const responder = await loginPhone('+919000000002');

    // Add two accepted SOS contacts so Step 1 would notify contact #2 if not cancelled
    const c1 = await owner.agent.post('/api/contacts').send({
      name: 'Contact One',
      phone_e164: '+919000000021',
      permissions: {
        receives_sos: true,
        receives_checkin: true,
        can_see_live_location: true,
      },
    });
    await request(app).post(`/api/invitations/${c1.body.invitation_token}/accept`);

    const c2 = await owner.agent.post('/api/contacts').send({
      name: 'Contact Two',
      phone_e164: '+919000000022',
      permissions: {
        receives_sos: true,
        receives_checkin: true,
        can_see_live_location: true,
      },
    });
    await request(app).post(`/api/invitations/${c2.body.invitation_token}/accept`);

    const createRes = await owner.agent.post('/api/incidents').send({
      client_request_id: 'req-6b-followup1-escalation-stop',
    });
    const incidentId = createRes.body.incident.id;
    clearAllScheduledTimers();

    const db = getDb();
    // Schedule short Step 1 (80ms) and Step 2 (140ms) escalation timers
    await activateAndDispatchIncident(incidentId, db, {
      step1DelayMs: 80,
      step2DelayMs: 140,
    });
    expect(hasScheduledEscalation(incidentId)).toBe(true);

    const smsRowsAfterT0 = await db.select().from(sentMessages);
    const notifRowsAfterT0 = await db
      .select()
      .from(notifications)
      .where(eq(notifications.incidentId, incidentId));
    const pushCountAfterT0 = defaultPushProvider.sentPushes.length;
    expect(defaultEmergencyGateway.requests).toHaveLength(0);

    // Responder acknowledges immediately before Step 1/Step 2 fire
    const ackRes = await responder.agent
      .post(`/api/responder/incidents/${incidentId}/acknowledge`)
      .send({ note: 'Responder on scene' });
    expect(ackRes.status).toBe(200);
    expect(ackRes.body.incident.status).toBe('ACKNOWLEDGED');

    // Escalation timers are immediately cancelled
    expect(hasScheduledEscalation(incidentId)).toBe(false);

    // Wait well past Step 1 (80ms) and Step 2 (140ms)
    await new Promise((r) => setTimeout(r, 220));

    // Zero additional escalation notifications and zero mock-112 gateway requests sent
    const smsRowsAfterWait = await db.select().from(sentMessages);
    const notifRowsAfterWait = await db
      .select()
      .from(notifications)
      .where(eq(notifications.incidentId, incidentId));
    expect(smsRowsAfterWait.length).toBe(smsRowsAfterT0.length);
    expect(notifRowsAfterWait.length).toBe(notifRowsAfterT0.length);
    expect(defaultPushProvider.sentPushes.length).toBe(pushCountAfterT0);
    expect(defaultEmergencyGateway.requests).toHaveLength(0);
  });

  it('4. Follow-up 2: Audit-log throttling — responder LIST access is logged at most once per 5 minutes per responder, while every DETAIL view and action is always logged', async () => {
    const owner = await loginPhone('+919000000001');
    const responder = await loginPhone('+919000000002');
    const admin = await loginPhone('+919000000003');

    const createRes = await owner.agent.post('/api/incidents').send({
      client_request_id: 'req-6b-followup2-audit-throttle',
    });
    const incidentId = createRes.body.incident.id;
    clearAllScheduledTimers();

    const db = getDb();
    await activateAndDispatchIncident(incidentId, db, {
      step1DelayMs: 60_000,
      step2DelayMs: 120_000,
    });

    // Call GET /api/responder/incidents 3 times in a row within 5 minutes
    await responder.agent.get('/api/responder/incidents');
    await responder.agent.get('/api/responder/incidents');
    await responder.agent.get('/api/responder/incidents');

    // Call GET /api/responder/incidents/:id 2 times in a row
    await responder.agent.get(`/api/responder/incidents/${incidentId}`);
    await responder.agent.get(`/api/responder/incidents/${incidentId}`);

    // Execute 2 actions in a row
    await responder.agent
      .post(`/api/responder/incidents/${incidentId}/note`)
      .send({ note: 'First responder note' });
    await responder.agent
      .post(`/api/responder/incidents/${incidentId}/acknowledge`)
      .send({ note: 'Responder acknowledged' });

    const auditRes = await admin.agent.get('/api/admin/audit-log');
    expect(auditRes.status).toBe(200);
    const entries = auditRes.body.entries.filter(
      (e: any) => e.actor_id === responder.userId
    );

    const listEntries = entries.filter(
      (e: any) => e.action === 'responder_list_incidents'
    );
    const viewEntries = entries.filter(
      (e: any) => e.action === 'responder_view_incident'
    );
    const noteEntries = entries.filter(
      (e: any) => e.action === 'responder_action:note'
    );
    const ackEntries = entries.filter(
      (e: any) => e.action === 'responder_action:acknowledge'
    );

    // LIST logged at most once within 5 minutes
    expect(listEntries).toHaveLength(1);
    // Every DETAIL view and every action is always logged
    expect(viewEntries).toHaveLength(2);
    expect(noteEntries).toHaveLength(1);
    expect(ackEntries).toHaveLength(1);
  });
});
