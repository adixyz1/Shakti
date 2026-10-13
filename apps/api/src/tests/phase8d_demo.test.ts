import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, startServer } from '../../server';
import { assertValidDemoModeConfiguration } from '../core/config';
import { closeDatabase, getDb, initDatabase } from '../core/db';
import { seedDatabase } from '../core/seed';
import {
  incidentAccessAudit,
  incidentEvents,
  incidents,
  reports,
  resources,
  responders,
  safetyPulses,
  trustedContacts,
  users,
} from '../db/schema';
import { isIncidentAuditChainValid } from '../services/metricsService';
import { clearAllScheduledTimers } from '../services/scheduler';

const testDbPath = path.join(
  os.tmpdir(),
  `saathi-phase8d-demo-${Date.now()}-${Math.random().toString(16).slice(2)}.db`
);

async function signInAgent(
  app: ReturnType<typeof createApp>,
  phoneE164: string,
  name: string
) {
  const agent = request.agent(app);
  agent.set('Origin', 'http://localhost:3000');
  const otpReq = await agent
    .post('/api/auth/otp/request')
    .send({ phone_e164: phoneE164 });
  expect(otpReq.status).toBe(200);
  const code = otpReq.body.dev_mock_hint;
  expect(code).toBeTruthy();

  const verifyRes = await agent.post('/api/auth/otp/verify').send({
    phone_e164: phoneE164,
    code,
    name,
  });
  expect(verifyRes.status).toBe(200);
  return { agent, user: verifyRes.body };
}

describe('Phase 8D: Demo Mode, Reset, Metrics Filtering & Simulation (Backend)', () => {
  const app = createApp();
  const originalDemoMode = process.env.DEMO_MODE;
  const originalNodeEnv = process.env.NODE_ENV;

  let userAgent: ReturnType<typeof request.agent>;
  let responderAgent: ReturnType<typeof request.agent>;
  let adminAgent: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    delete process.env.DEMO_MODE;
    const db = await initDatabase(`file:${testDbPath}`);
    await seedDatabase(db);

    userAgent = (await signInAgent(app, '+919000000001', 'Aarohi Sharma'))
      .agent;
    responderAgent = (
      await signInAgent(app, '+919000000002', 'Inspector Kavita Rao')
    ).agent;
    adminAgent = (await signInAgent(app, '+919000000003', 'Meera Nair')).agent;
  });

  afterAll(async () => {
    clearAllScheduledTimers();
    if (originalDemoMode === undefined) {
      delete process.env.DEMO_MODE;
    } else {
      process.env.DEMO_MODE = originalDemoMode;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    await closeDatabase();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it('1. Server refuses to start when DEMO_MODE=true and NODE_ENV=production (no override)', async () => {
    expect(() =>
      assertValidDemoModeConfiguration({
        NODE_ENV: 'production',
        DEMO_MODE: 'true',
      })
    ).toThrow(/DEMO_MODE=true is forbidden when NODE_ENV=production/i);

    await expect(
      startServer({
        NODE_ENV: 'production',
        DEMO_MODE: 'true',
      })
    ).rejects.toThrow(/DEMO_MODE=true is forbidden when NODE_ENV=production/i);

    // Allowed when DEMO_MODE is false in production or DEMO_MODE is true in development
    expect(() =>
      assertValidDemoModeConfiguration({
        NODE_ENV: 'production',
        DEMO_MODE: 'false',
      })
    ).not.toThrow();
    expect(() =>
      assertValidDemoModeConfiguration({
        NODE_ENV: 'development',
        DEMO_MODE: 'true',
      })
    ).not.toThrow();
  });

  it('2. Every demo endpoint returns 404 when DEMO_MODE is off (default)', async () => {
    delete process.env.DEMO_MODE;

    const statusRes = await adminAgent.get('/api/demo/status');
    expect(statusRes.status).toBe(404);

    const resetRes = await adminAgent.post('/api/demo/reset');
    expect(resetRes.status).toBe(404);

    const simRespRes = await adminAgent
      .post('/api/demo/simulate/responder')
      .send({ action: 'acknowledge' });
    expect(simRespRes.status).toBe(404);

    const simContactRes = await adminAgent
      .post('/api/demo/simulate/contact')
      .send({ action: 'seen' });
    expect(simContactRes.status).toBe(404);
  });

  it('3. POST /api/demo/reset is admin-only and idempotent, restoring seeded demo users, accepted contacts, responder, resources, and demo rows', async () => {
    process.env.DEMO_MODE = 'true';

    // Non-admin attempts are forbidden (403)
    const userReset = await userAgent.post('/api/demo/reset');
    expect(userReset.status).toBe(403);

    const respReset = await responderAgent.post('/api/demo/reset');
    expect(respReset.status).toBe(403);

    // Admin executes reset #1
    const reset1 = await adminAgent.post('/api/demo/reset');
    expect(reset1.status).toBe(200);
    expect(reset1.body.status).toBe('demo_reset_complete');
    expect(reset1.body.seeded.demo_incidents).toBeGreaterThanOrEqual(5);
    expect(reset1.body.seeded.demo_reports).toBeGreaterThanOrEqual(5);
    expect(reset1.body.seeded.demo_safety_pulses).toBeGreaterThanOrEqual(5);
    expect(reset1.body.seeded.accepted_contacts).toBeGreaterThanOrEqual(1);

    const db = getDb();
    const countsAfterFirst = {
      users: (await db.select().from(users)).length,
      contacts: (await db.select().from(trustedContacts)).length,
      responders: (await db.select().from(responders)).length,
      resources: (await db.select().from(resources)).length,
      demoIncidents: (await db.select().from(incidents)).filter((i) => i.isDemo)
        .length,
      demoReports: (await db.select().from(reports)).filter((r) => r.isDemo)
        .length,
      demoPulses: (await db.select().from(safetyPulses)).filter((p) => p.isDemo)
        .length,
    };

    // Admin executes reset #2 (idempotent: exact same row counts, no duplicates)
    const reset2 = await adminAgent.post('/api/demo/reset');
    expect(reset2.status).toBe(200);

    const countsAfterSecond = {
      users: (await db.select().from(users)).length,
      contacts: (await db.select().from(trustedContacts)).length,
      responders: (await db.select().from(responders)).length,
      resources: (await db.select().from(resources)).length,
      demoIncidents: (await db.select().from(incidents)).filter((i) => i.isDemo)
        .length,
      demoReports: (await db.select().from(reports)).filter((r) => r.isDemo)
        .length,
      demoPulses: (await db.select().from(safetyPulses)).filter((p) => p.isDemo)
        .length,
    };

    expect(countsAfterSecond).toEqual(countsAfterFirst);
  });

  it('4. Metrics include is_demo rows ONLY when DEMO_MODE=true and exclude is_demo rows when DEMO_MODE is off', async () => {
    // With DEMO_MODE=true, seeded demo rows pass the minimum sample rule (n >= 5)
    process.env.DEMO_MODE = 'true';
    const metricsOnRes = await adminAgent.get('/api/admin/metrics');
    expect(metricsOnRes.status).toBe(200);
    expect(metricsOnRes.body.includes_demo_data).toBe(true);
    expect(
      metricsOnRes.body.metrics.alert_initiation_time.insufficient_data
    ).toBe(false);
    expect(
      metricsOnRes.body.metrics.alert_initiation_time.n
    ).toBeGreaterThanOrEqual(5);
    expect(
      metricsOnRes.body.metrics.time_to_first_acknowledgement.insufficient_data
    ).toBe(false);
    expect(
      metricsOnRes.body.metrics.time_to_resolution.insufficient_data
    ).toBe(false);
    expect(
      metricsOnRes.body.metrics.notification_delivery_rate.insufficient_data
    ).toBe(false);
    expect(
      metricsOnRes.body.metrics.location_availability.insufficient_data
    ).toBe(false);
    expect(
      metricsOnRes.body.metrics.audit_completeness.insufficient_data
    ).toBe(false);
    expect(metricsOnRes.body.metrics.audit_completeness.value).toBe(100);
    expect(metricsOnRes.body.metrics.safety_pulse.insufficient_data).toBe(
      false
    );
    expect(
      metricsOnRes.body.metrics.post_incident_trust_score.insufficient_data
    ).toBe(false);

    // Safety layer also includes demo reports when DEMO_MODE=true
    const layerOnRes = await adminAgent.get('/api/safety-layer');
    expect(layerOnRes.status).toBe(200);
    expect(layerOnRes.body.cells.length).toBeGreaterThanOrEqual(1);

    // Turn DEMO_MODE off -> metrics must exclude all is_demo rows
    process.env.DEMO_MODE = 'false';
    const metricsOffRes = await adminAgent.get('/api/admin/metrics');
    expect(metricsOffRes.status).toBe(200);
    expect(metricsOffRes.body.includes_demo_data).toBe(false);
    expect(metricsOffRes.body.metrics.alert_initiation_time.n).toBe(0);
    expect(
      metricsOffRes.body.metrics.alert_initiation_time.insufficient_data
    ).toBe(true);
    expect(metricsOffRes.body.metrics.time_to_resolution.n).toBe(0);
    expect(metricsOffRes.body.metrics.safety_pulse.n).toBe(0);
    expect(metricsOffRes.body.metrics.post_incident_trust_score.n).toBe(0);

    // Safety layer excludes demo reports when DEMO_MODE=false
    const layerOffRes = await adminAgent.get('/api/safety-layer');
    expect(layerOffRes.status).toBe(200);
    expect(layerOffRes.body.cells.length).toBe(0);
  });

  it('5. Simulate actions (contact & responder) go through the real services and state machine and produce audit/event rows marked simulated', async () => {
    process.env.DEMO_MODE = 'true';

    // Trigger a live SOS incident as the demo user
    const createIncRes = await userAgent.post('/api/incidents').send({
      client_request_id: `demo_live_sos_${Date.now()}`,
      source_trigger: 'button',
      emergency_type: 'followed',
      location: {
        lat: 28.6139,
        lng: 77.209,
        accuracy_m: 10,
      },
    });
    expect(createIncRes.status).toBe(201);
    const incidentId = createIncRes.body.incident.id;

    // A responder role account (non-admin, non-demo-user) cannot call simulate endpoints
    const forbiddenSim = await responderAgent
      .post('/api/demo/simulate/responder')
      .send({ incident_id: incidentId, action: 'acknowledge', delay_ms: 0 });
    expect(forbiddenSim.status).toBe(403);

    // 1) Demo user simulates contact "seen" -> transitions TRIGGERED -> ACTIVE -> ACKNOWLEDGED
    const simContactSeen = await userAgent
      .post('/api/demo/simulate/contact')
      .send({
        incident_id: incidentId,
        action: 'seen',
        delay_ms: 10,
      });
    expect(simContactSeen.status).toBe(200);
    expect(simContactSeen.body.simulated).toBe(true);
    expect(simContactSeen.body.incident_status).toBe('ACKNOWLEDGED');

    // 2) Demo user simulates contact "on_my_way" -> transitions ACKNOWLEDGED -> RESPONDING
    const simContactWay = await userAgent
      .post('/api/demo/simulate/contact')
      .send({
        incident_id: incidentId,
        action: 'on_my_way',
        delay_ms: 10,
      });
    expect(simContactWay.status).toBe(200);
    expect(simContactWay.body.incident_status).toBe('RESPONDING');

    // 3) Demo user simulates responder "acknowledge", "responding", and "resolve" -> transitions to RESOLVED
    const simRespAck = await userAgent
      .post('/api/demo/simulate/responder')
      .send({
        incident_id: incidentId,
        action: 'acknowledge',
        delay_ms: 10,
      });
    expect(simRespAck.status).toBe(200);
    expect(simRespAck.body.incident_status).toBe('RESPONDING');

    const simRespWay = await userAgent
      .post('/api/demo/simulate/responder')
      .send({
        incident_id: incidentId,
        action: 'responding',
        delay_ms: 10,
      });
    expect(simRespWay.status).toBe(200);
    expect(simRespWay.body.incident_status).toBe('RESPONDING');

    const simRespResolve = await userAgent
      .post('/api/demo/simulate/responder')
      .send({
        incident_id: incidentId,
        action: 'resolve',
        delay_ms: 10,
      });
    expect(simRespResolve.status).toBe(200);
    expect(simRespResolve.body.incident_status).toBe('RESOLVED');

    // Verify incident_events chain is 100% valid through the state machine and carries [simulated] markers
    const db = getDb();
    const [incRow] = await db.select().from(incidents);
    const targetInc = (await db.select().from(incidents)).find(
      (i) => i.id === incidentId
    )!;
    expect(incRow).toBeTruthy();
    expect(targetInc.status).toBe('RESOLVED');

    const evRows = (await db.select().from(incidentEvents)).filter(
      (e) => e.incidentId === incidentId
    );
    expect(isIncidentAuditChainValid(targetInc, evRows)).toBe(true);
    expect(
      evRows.some((e) => (e.note || '').toLowerCase().includes('simulated'))
    ).toBe(true);

    // Verify incident_access_audit rows carry clear "simulated" marker in action, actorLabel, and detail
    const auditRows = (await db.select().from(incidentAccessAudit)).filter(
      (a) => a.incidentId === incidentId
    );
    expect(auditRows.length).toBeGreaterThanOrEqual(4);
    const simulatedAuditRows = auditRows.filter(
      (a) =>
        a.action.startsWith('simulated:') &&
        (a.actorLabel || '').includes('(simulated)') &&
        (a.detail || '').includes('[simulated]')
    );
    expect(simulatedAuditRows.length).toBeGreaterThanOrEqual(4);
  });
});
