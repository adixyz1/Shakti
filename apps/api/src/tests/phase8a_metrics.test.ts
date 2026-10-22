import { defaultOtpProvider } from '../providers/otp';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server';
import { closeDatabase, initDatabase, type AppDatabase } from '../core/db';
import { resetRateLimiter } from '../core/middleware';
import { hashDuressPin } from '../core/security';
import { seedDatabase } from '../core/seed';
import {
  consents,
  incidentEvents,
  incidents,
  locationSamples,
  notifications,
  safetyPulses,
  users,
} from '../db/schema';
import { clearAllScheduledTimers } from '../services/scheduler';

describe('Phase 8A: Impact Metrics & Post-Incident Ratings (Backend)', () => {
  let db: AppDatabase;
  let tempDbPath: string;

  beforeEach(async () => {
    process.env.DEMO_MODE = 'true';
    process.env.DEMO_ADMIN_HINT = 'true';
    resetRateLimiter();
    clearAllScheduledTimers();
    tempDbPath = path.join(
      os.tmpdir(),
      `saathi-phase8a-${crypto.randomUUID()}.db`
    );
    db = await initDatabase(`file:${tempDbPath}`);
    await seedDatabase(db);
  });

  afterEach(async () => {
    clearAllScheduledTimers();
    await closeDatabase();
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const p = `${tempDbPath}${suffix}`;
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
      }
    }
  });

  async function loginAs(
    app: ReturnType<typeof createApp>,
    phoneE164: string
  ) {
    const agent = request.agent(app);
    agent.set('Origin', 'http://localhost:3000');
    const otpReq = await agent
      .post('/api/auth/otp/request')
      .send({ phone_e164: phoneE164 });
    expect(otpReq.status).toBe(200);
    const verifyRes = await agent.post('/api/auth/otp/verify').send({
      phone_e164: phoneE164,
      code: (otpReq.body.dev_mock_hint || (defaultOtpProvider as any).lastOtpCode || "000000"),
    });
    expect(verifyRes.status).toBe(200);
    const [userRow] = await db
      .select()
      .from(users)
      .where(eq(users.phoneE164, phoneE164))
      .limit(1);
    return { agent, userId: userRow.id };
  }

  it('1. POST /api/incidents/:id/rating: owner only, allowed only after close (or masked duress view without changing incident), once per incident, and stores no user_id', async () => {
    const app = createApp();
    const { agent: userAgent, userId: demoUserId } = await loginAs(
      app,
      '+919000000001'
    );
    const { agent: responderAgent } = await loginAs(app, '+919000000002');

    // Configure duress PIN on demoUserId (+919000000001)
    const duressHash = await hashDuressPin(demoUserId, '9999');
    await db
      .update(users)
      .set({ duressPinHash: duressHash })
      .where(eq(users.id, demoUserId));

    // A. Open normal incident -> rating BEFORE close must fail with 400
    const openIncId = 'inc_rate_open_1';
    await db.insert(incidents).values({
      id: openIncId,
      userId: demoUserId,
      status: 'ACTIVE',
      emergencyType: 'unsafe',
      clientRequestId: 'req_rate_open_1',
      clientCreatedAt: '2026-10-05T10:00:00.000Z',
      queuedOffline: false,
      createdAt: '2026-10-05T10:00:01.000Z',
      activatedAt: '2026-10-05T10:00:06.000Z',
      closedAt: null,
      mergedIntoId: null,
      sourceTrigger: 'button',
      isDuress: false,
    });

    const prematureRate = await userAgent
      .post(`/api/incidents/${openIncId}/rating`)
      .send({ score: 5 });
    expect(prematureRate.status).toBe(400);

    // B. Close incident -> owner can rate once (201), non-owner gets 403, second attempt gets 409
    await db.insert(incidents).values({
      id: 'inc_rate_closed_1',
      userId: demoUserId,
      status: 'RESOLVED',
      emergencyType: 'unsafe',
      clientRequestId: 'req_rate_closed_1',
      clientCreatedAt: '2026-10-05T11:00:00.000Z',
      queuedOffline: false,
      createdAt: '2026-10-05T11:00:01.000Z',
      activatedAt: '2026-10-05T11:00:06.000Z',
      closedAt: '2026-10-05T11:05:06.000Z',
      mergedIntoId: null,
      sourceTrigger: 'button',
      isDuress: false,
    });

    const nonOwnerAttempt = await responderAgent
      .post('/api/incidents/inc_rate_closed_1/rating')
      .send({ score: 4 });
    expect(nonOwnerAttempt.status).toBe(403);

    const invalidScoreAttempt = await userAgent
      .post('/api/incidents/inc_rate_closed_1/rating')
      .send({ score: 6 });
    expect(invalidScoreAttempt.status).toBe(422);

    const firstRate = await userAgent
      .post('/api/incidents/inc_rate_closed_1/rating')
      .send({ score: 4 });
    expect(firstRate.status).toBe(201);
    expect(firstRate.body.rating).toEqual({
      incident_id: 'inc_rate_closed_1',
      score: 4,
      created_at: expect.any(String),
    });
    expect(firstRate.body.rating.user_id).toBeUndefined();

    const duplicateRate = await userAgent
      .post('/api/incidents/inc_rate_closed_1/rating')
      .send({ score: 5 });
    expect(duplicateRate.status).toBe(409);

    // C. Duress incident: real status is ACTIVE (closedAt = null, isDuress = true),
    // but owner's masked view shows it as closed -> rating MUST succeed without changing the incident
    await db.insert(incidents).values({
      id: 'inc_rate_duress_1',
      userId: demoUserId,
      status: 'ACTIVE',
      emergencyType: 'followed',
      clientRequestId: 'req_rate_duress_1',
      clientCreatedAt: '2026-10-05T12:00:00.000Z',
      queuedOffline: false,
      createdAt: '2026-10-05T12:00:01.000Z',
      activatedAt: '2026-10-05T12:00:06.000Z',
      closedAt: null,
      mergedIntoId: null,
      sourceTrigger: 'button',
      isDuress: true,
    });

    const duressRate = await userAgent
      .post('/api/incidents/inc_rate_duress_1/rating')
      .send({ score: 5 });
    expect(duressRate.status).toBe(201);
    expect(duressRate.body.rating.incident_id).toBe('inc_rate_duress_1');
    expect(duressRate.body.rating.score).toBe(5);

    // Verify the duress incident itself was NOT modified in any way (still ACTIVE, closedAt still null)
    const allInc = await db.select().from(incidents);
    const duressRow = allInc.find((i) => i.id === 'inc_rate_duress_1')!;
    expect(duressRow.status).toBe('ACTIVE');
    expect(duressRow.closedAt).toBeNull();
    expect(duressRow.isDuress).toBe(true);
  });

  it('2. Admin-only access control (403 for user and responder) & Minimum Sample Rule (insufficient_data: true and value: null when n < 5)', async () => {
    const app = createApp();
    const { agent: userAgent, userId: demoUserId } = await loginAs(
      app,
      '+919000000001'
    );
    const { agent: responderAgent } = await loginAs(app, '+919000000002');
    const { agent: adminAgent } = await loginAs(app, '+919000000003');

    // User -> 403
    const userRes = await userAgent.get('/api/admin/metrics');
    expect(userRes.status).toBe(403);
    const userCsvRes = await userAgent.get('/api/admin/metrics.csv');
    expect(userCsvRes.status).toBe(403);

    // Responder -> 403
    const respRes = await responderAgent.get('/api/admin/metrics');
    expect(respRes.status).toBe(403);
    const respCsvRes = await responderAgent.get('/api/admin/metrics.csv');
    expect(respCsvRes.status).toBe(403);

    // Seed only 3 incidents (< 5 minimum sample threshold)
    for (let i = 1; i <= 3; i++) {
      const id = `inc_small_${i}`;
      await db.insert(incidents).values({
        id,
        userId: demoUserId,
        status: 'RESOLVED',
        emergencyType: 'unsafe',
        clientRequestId: `req_small_${i}`,
        clientCreatedAt: `2026-10-05T10:0${i}:00.000Z`,
        queuedOffline: false,
        createdAt: `2026-10-05T10:0${i}:02.000Z`,
        activatedAt: `2026-10-05T10:0${i}:07.000Z`,
        closedAt: `2026-10-05T10:0${i}:37.000Z`,
        mergedIntoId: null,
        sourceTrigger: 'button',
        isDuress: false,
      });
    }

    const adminRes = await adminAgent.get(
      '/api/admin/metrics?from=2026-10-01&to=2026-10-06'
    );
    expect(adminRes.status).toBe(200);
    const m = adminRes.body.metrics;

    // Every single metric has n < 5, so insufficient_data MUST be true and value MUST be null
    for (const key of Object.keys(m)) {
      expect(m[key].insufficient_data).toBe(true);
      expect(m[key].value).toBeNull();
    }
    expect(m.alert_initiation_time.n).toBe(3);
    expect(m.time_to_active.n).toBe(3);
    expect(m.time_to_first_acknowledgement.p90_seconds).toBeNull();
    expect(m.location_availability.median_accuracy_meters).toBeNull();
  });

  it('3. All 10 metrics match hand-calculated arithmetic from fixture data, offline-queued alerts are excluded from initiation median, and CSV matches JSON', async () => {
    const app = createApp();
    const { agent: userAgent, userId: demoUserId } = await loginAs(
      app,
      '+919000000001'
    );
    const { agent: adminAgent } = await loginAs(app, '+919000000003');

    // Create a second user who has location consent explicitly OFF
    await db.insert(users).values({
      id: 'usr_loc_off_02',
      phoneE164: '+919000000099',
      name: 'Neha Verma',
      role: 'user',
      language: 'en',
      organizationZone: 'Demo Campus Zone',
      cancelWindowSeconds: 5,
      createdAt: '2026-10-01T00:00:00.000Z',
    });
    await db.insert(consents).values({
      id: 'con_loc_on_1',
      userId: demoUserId,
      type: 'location',
      granted: true,
      source: 'consent_center',
      createdAt: '2026-10-01T00:00:00.000Z',
    });
    await db.insert(consents).values({
      id: 'con_loc_off_2',
      userId: 'usr_loc_off_02',
      type: 'location',
      granted: false,
      source: 'consent_center',
      createdAt: '2026-10-01T00:00:00.000Z',
    });

    /*
     * =========================================================================
     * HAND-COMPUTED FIXTURE DATA & ARITHMETIC (8 Primary Incidents: inc_1..inc_8)
     * =========================================================================
     *
     * Metric 1: Alert-Initiation Time (client_created_at -> server created_at)
     * - Online incidents (queuedOffline = false), n = 6:
     *   inc_1: 10:00:00 -> 10:00:01 = 1 s
     *   inc_2: 10:10:00 -> 10:10:02 = 2 s
     *   inc_3: 10:20:00 -> 10:20:03 = 3 s
     *   inc_4: 10:30:00 -> 10:30:04 = 4 s
     *   inc_5 (duress): 10:40:00 -> 10:40:08 = 8 s
     *   inc_7 (cancelled): 11:00:00 -> 11:00:09 = 9 s
     *   Sorted online durations: [1, 2, 3, 4, 8, 9]
     *   Median (n=6): (sorted[2] + sorted[3]) / 2 = (3 + 4) / 2 = 3.5 s
     * - Queued/offline-created incidents (queuedOffline = true), n = 2:
     *   inc_6: 10:45:00 -> 10:50:00 = 300 s
     *   inc_8: 11:05:00 -> 11:10:00 = 300 s
     *   (Excluded from online median! Reported separately under queued_then_delivered with n=2, insufficient_data=true, value=null.)
     *
     * Metric 2: Time to Active (created_at -> activated_at, informational)
     * - Incidents reaching ACTIVE: inc_1..inc_6 (n = 6):
     *   inc_1: 10:00:01 -> 10:00:06 = 5 s
     *   inc_2: 10:10:02 -> 10:10:07 = 5 s
     *   inc_3: 10:20:03 -> 10:20:08 = 5 s
     *   inc_4: 10:30:04 -> 10:30:10 = 6 s
     *   inc_5 (duress): 10:40:08 -> 10:40:15 = 7 s
     *   inc_6 (false alarm): 10:50:00 -> 10:50:08 = 8 s
     *   Sorted: [5, 5, 5, 6, 7, 8]
     *   Median (n=6): (5 + 6) / 2 = 5.5 s
     *
     * Metric 3: Notification Delivery Rate (sent/delivered / all attempted)
     * - SMS channel (n = 5): 4 sent/delivered, 1 failed -> 4 / 5 * 100 = 80%
     * - Push channel (n = 5): 5 delivered, 0 failed -> 5 / 5 * 100 = 100%
     * - Gateway channel (n = 2): 2 sent -> n = 2 < 5 -> insufficient_data = true, value = null
     * - Overall: (4 + 5 + 2) / (5 + 5 + 2) = 11 / 12 * 100 = 91.666...% -> 91.67%
     *
     * Metric 4: Time to First Acknowledgement (ACTIVE -> first ACKNOWLEDGED)
     * - Acknowledged active incidents: inc_1..inc_5 (n = 5):
     *   inc_1: 10:00:06 -> 10:00:26 = 20 s
     *   inc_2: 10:10:07 -> 10:10:37 = 30 s
     *   inc_3: 10:20:08 -> 10:20:48 = 40 s
     *   inc_4: 10:30:10 -> 10:31:00 = 50 s
     *   inc_5 (duress): 10:40:15 -> 10:41:45 = 90 s
     *   Sorted (n=5): [20, 30, 40, 50, 90]
     *   Median: sorted[2] = 40 s
     *   90th percentile: sorted[ceil(0.9 * 5) - 1] = sorted[4] = 90 s
     *
     * Metric 5: Time to Resolution (ACTIVE -> RESOLVED)
     * - Resolved active incidents: inc_1..inc_5 (n = 5):
     *   inc_1: 10:00:06 -> 10:02:06 = 120 s
     *   inc_2: 10:10:07 -> 10:12:37 = 150 s
     *   inc_3: 10:20:08 -> 10:23:08 = 180 s
     *   inc_4: 10:30:10 -> 10:34:10 = 240 s
     *   inc_5 (duress): 10:40:15 -> 10:45:15 = 300 s
     *   Sorted (n=5): [120, 150, 180, 240, 300]
     *   Median: sorted[2] = 180 s
     *
     * Metric 6: Cancellation Rate & False-Alarm Rate
     * - Cancellation rate: CANCELLED (inc_7, inc_8 = 2) / all incidents (8) * 100 = 25%
     * - False-alarm rate: FALSE_ALARM (inc_6 = 1) / active incidents (6) * 100 = 16.67%
     *
     * Metric 7: Location Availability
     * - Active incidents with >= 1 location sample: inc_1..inc_5 = 5 out of 6 active -> 5 / 6 * 100 = 83.33%
     * - Accuracy samples on inc_1..inc_5: [8, 10, 12, 15, 25] m -> median (n=5) = 12 m
     * - Active incidents with location consent off: inc_6 (belongs to usr_loc_off_02) = 1
     *
     * Metric 8: Audit Completeness
     * - Valid chains from TRIGGERED to current status: inc_1..inc_7 = 7 valid;
     *   inc_8 has status CANCELLED but only a TRIGGERED event (missing CANCELLED transition) -> 1 invalid.
     * - Completeness = 7 / 8 * 100 = 87.5%
     *
     * Metric 9: Safety Pulse (by week & overall)
     * - Week 2026-W40 (n = 5 pulses on 2026-10-01..2026-10-04):
     *   Scores: [5, 4, 4, 3, 2] -> sum = 18 -> avg = 18 / 5 = 3.6
     *   Avoided going somewhere: [false, true, false, true, false] -> 2 / 5 * 100 = 40%
     * - Week 2026-W41 (n = 2 pulses on 2026-10-05..2026-10-06):
     *   Scores: [5, 3], Avoided: [false, true] -> n = 2 < 5 -> insufficient_data = true, value = null
     * - Overall (n = 7 pulses):
     *   Scores sum = 18 + 8 = 26 -> avg = 26 / 7 = 3.714... -> 3.71
     *   Avoided count = 2 + 1 = 3 -> 3 / 7 * 100 = 42.857... -> 42.86%
     *
     * Metric 10: Post-Incident Trust Score
     * - Ratings on inc_1..inc_5 (n = 5): scores [5, 4, 5, 3, 4]
     * - Average = (5 + 4 + 5 + 3 + 4) / 5 = 21 / 5 = 4.2
     */

    const fixtureIncidents = [
      {
        id: 'inc_1',
        userId: demoUserId,
        status: 'RESOLVED' as const,
        clientRequestId: 'req_f_1',
        clientCreatedAt: '2026-10-02T10:00:00.000Z',
        queuedOffline: false,
        createdAt: '2026-10-02T10:00:01.000Z', // +1s init
        activatedAt: '2026-10-02T10:00:06.000Z', // +5s active
        ackAt: '2026-10-02T10:00:26.000Z', // +20s ack
        closedAt: '2026-10-02T10:02:06.000Z', // +120s resolve
        isDuress: false,
        accuracyM: 8,
        rating: 5,
      },
      {
        id: 'inc_2',
        userId: demoUserId,
        status: 'RESOLVED' as const,
        clientRequestId: 'req_f_2',
        clientCreatedAt: '2026-10-02T10:10:00.000Z',
        queuedOffline: false,
        createdAt: '2026-10-02T10:10:02.000Z', // +2s init
        activatedAt: '2026-10-02T10:10:07.000Z', // +5s active
        ackAt: '2026-10-02T10:10:37.000Z', // +30s ack
        closedAt: '2026-10-02T10:12:37.000Z', // +150s resolve
        isDuress: false,
        accuracyM: 10,
        rating: 4,
      },
      {
        id: 'inc_3',
        userId: demoUserId,
        status: 'RESOLVED' as const,
        clientRequestId: 'req_f_3',
        clientCreatedAt: '2026-10-02T10:20:00.000Z',
        queuedOffline: false,
        createdAt: '2026-10-02T10:20:03.000Z', // +3s init
        activatedAt: '2026-10-02T10:20:08.000Z', // +5s active
        ackAt: '2026-10-02T10:20:48.000Z', // +40s ack
        closedAt: '2026-10-02T10:23:08.000Z', // +180s resolve
        isDuress: false,
        accuracyM: 12,
        rating: 5,
      },
      {
        id: 'inc_4',
        userId: demoUserId,
        status: 'RESOLVED' as const,
        clientRequestId: 'req_f_4',
        clientCreatedAt: '2026-10-02T10:30:00.000Z',
        queuedOffline: false,
        createdAt: '2026-10-02T10:30:04.000Z', // +4s init
        activatedAt: '2026-10-02T10:30:10.000Z', // +6s active
        ackAt: '2026-10-02T10:31:00.000Z', // +50s ack
        closedAt: '2026-10-02T10:34:10.000Z', // +240s resolve
        isDuress: false,
        accuracyM: 15,
        rating: 3,
      },
      {
        id: 'inc_5',
        userId: demoUserId,
        status: 'RESOLVED' as const,
        clientRequestId: 'req_f_5',
        clientCreatedAt: '2026-10-02T10:40:00.000Z',
        queuedOffline: false,
        createdAt: '2026-10-02T10:40:08.000Z', // +8s init
        activatedAt: '2026-10-02T10:40:15.000Z', // +7s active
        ackAt: '2026-10-02T10:41:45.000Z', // +90s ack
        closedAt: '2026-10-02T10:45:15.000Z', // +300s resolve
        isDuress: true, // Duress incident included in aggregates, never singled out
        accuracyM: 25,
        rating: 4,
      },
    ];

    for (const item of fixtureIncidents) {
      await db.insert(incidents).values({
        id: item.id,
        userId: item.userId,
        status: item.status,
        emergencyType: 'unsafe',
        clientRequestId: item.clientRequestId,
        clientCreatedAt: item.clientCreatedAt,
        queuedOffline: item.queuedOffline,
        createdAt: item.createdAt,
        activatedAt: item.activatedAt,
        closedAt: item.closedAt,
        mergedIntoId: null,
        sourceTrigger: 'button',
        isDuress: item.isDuress,
      });

      // Valid event chain: null -> TRIGGERED -> ACTIVE -> ACKNOWLEDGED -> RESOLVED
      await db.insert(incidentEvents).values([
        {
          id: `ev_${item.id}_1`,
          incidentId: item.id,
          fromStatus: null,
          toStatus: 'TRIGGERED',
          actorType: 'user',
          actorId: item.userId,
          note: 'Triggered',
          createdAt: item.createdAt,
        },
        {
          id: `ev_${item.id}_2`,
          incidentId: item.id,
          fromStatus: 'TRIGGERED',
          toStatus: 'ACTIVE',
          actorType: 'system',
          actorId: null,
          note: 'Activated',
          createdAt: item.activatedAt,
        },
        {
          id: `ev_${item.id}_3`,
          incidentId: item.id,
          fromStatus: 'ACTIVE',
          toStatus: 'ACKNOWLEDGED',
          actorType: 'responder',
          actorId: 'usr_demo_responder_01',
          note: 'Acknowledged',
          createdAt: item.ackAt,
        },
        {
          id: `ev_${item.id}_4`,
          incidentId: item.id,
          fromStatus: 'ACKNOWLEDGED',
          toStatus: 'RESOLVED',
          actorType: 'responder',
          actorId: 'usr_demo_responder_01',
          note: 'Resolved',
          createdAt: item.closedAt,
        },
      ]);

      await db.insert(locationSamples).values({
        id: `loc_${item.id}`,
        incidentId: item.id,
        lat: 28.6139,
        lng: 77.209,
        accuracyM: item.accuracyM,
        capturedAt: item.activatedAt,
        expiresAt: Date.now() + 86400000,
      });

      const rateRes = await userAgent
        .post(`/api/incidents/${item.id}/rating`)
        .send({ score: item.rating });
      expect(rateRes.status).toBe(201);
    }

    // inc_6: Queued offline (300s delay), reached ACTIVE (+8s), then FALSE_ALARM; belongs to usr_loc_off_02 (consent off, 0 location samples)
    await db.insert(incidents).values({
      id: 'inc_6',
      userId: 'usr_loc_off_02',
      status: 'FALSE_ALARM',
      emergencyType: 'other',
      clientRequestId: 'req_f_6',
      clientCreatedAt: '2026-10-02T10:45:00.000Z',
      queuedOffline: true,
      createdAt: '2026-10-02T10:50:00.000Z',
      activatedAt: '2026-10-02T10:50:08.000Z',
      closedAt: '2026-10-02T10:52:00.000Z',
      mergedIntoId: null,
      sourceTrigger: 'button',
      isDuress: false,
    });
    await db.insert(incidentEvents).values([
      {
        id: 'ev_inc_6_1',
        incidentId: 'inc_6',
        fromStatus: null,
        toStatus: 'TRIGGERED',
        actorType: 'user',
        actorId: 'usr_loc_off_02',
        note: 'Triggered',
        createdAt: '2026-10-02T10:50:00.000Z',
      },
      {
        id: 'ev_inc_6_2',
        incidentId: 'inc_6',
        fromStatus: 'TRIGGERED',
        toStatus: 'ACTIVE',
        actorType: 'system',
        actorId: null,
        note: 'Activated',
        createdAt: '2026-10-02T10:50:08.000Z',
      },
      {
        id: 'ev_inc_6_3',
        incidentId: 'inc_6',
        fromStatus: 'ACTIVE',
        toStatus: 'FALSE_ALARM',
        actorType: 'responder',
        actorId: 'usr_demo_responder_01',
        note: 'False alarm',
        createdAt: '2026-10-02T10:52:00.000Z',
      },
    ]);

    // inc_7: Online (9s init), CANCELLED inside cancel window, valid event chain
    await db.insert(incidents).values({
      id: 'inc_7',
      userId: demoUserId,
      status: 'CANCELLED',
      emergencyType: null,
      clientRequestId: 'req_f_7',
      clientCreatedAt: '2026-10-02T11:00:00.000Z',
      queuedOffline: false,
      createdAt: '2026-10-02T11:00:09.000Z',
      activatedAt: null,
      closedAt: '2026-10-02T11:00:12.000Z',
      mergedIntoId: null,
      sourceTrigger: 'button',
      isDuress: false,
    });
    await db.insert(incidentEvents).values([
      {
        id: 'ev_inc_7_1',
        incidentId: 'inc_7',
        fromStatus: null,
        toStatus: 'TRIGGERED',
        actorType: 'user',
        actorId: demoUserId,
        note: 'Triggered',
        createdAt: '2026-10-02T11:00:09.000Z',
      },
      {
        id: 'ev_inc_7_2',
        incidentId: 'inc_7',
        fromStatus: 'TRIGGERED',
        toStatus: 'CANCELLED',
        actorType: 'user',
        actorId: demoUserId,
        note: 'Cancelled',
        createdAt: '2026-10-02T11:00:12.000Z',
      },
    ]);

    // inc_8: Queued offline (300s delay), CANCELLED, but intentionally missing TRIGGERED -> CANCELLED event to test audit_completeness = 7/8 = 87.5%
    await db.insert(incidents).values({
      id: 'inc_8',
      userId: demoUserId,
      status: 'CANCELLED',
      emergencyType: null,
      clientRequestId: 'req_f_8',
      clientCreatedAt: '2026-10-02T11:05:00.000Z',
      queuedOffline: true,
      createdAt: '2026-10-02T11:10:00.000Z',
      activatedAt: null,
      closedAt: '2026-10-02T11:10:03.000Z',
      mergedIntoId: null,
      sourceTrigger: 'button',
      isDuress: false,
    });
    await db.insert(incidentEvents).values([
      {
        id: 'ev_inc_8_1',
        incidentId: 'inc_8',
        fromStatus: null,
        toStatus: 'TRIGGERED',
        actorType: 'user',
        actorId: demoUserId,
        note: 'Triggered without cancel event',
        createdAt: '2026-10-02T11:10:00.000Z',
      },
    ]);

    // Seed 12 notifications: 5 SMS (4 sent/delivered, 1 failed), 5 Push (5 delivered), 2 Gateway (2 sent)
    const notifFixture = [
      { id: 'nf_sms_1', channel: 'sms' as const, status: 'sent' as const },
      { id: 'nf_sms_2', channel: 'sms' as const, status: 'delivered' as const },
      { id: 'nf_sms_3', channel: 'sms' as const, status: 'sent' as const },
      { id: 'nf_sms_4', channel: 'sms' as const, status: 'delivered' as const },
      { id: 'nf_sms_5', channel: 'sms' as const, status: 'failed' as const },
      { id: 'nf_push_1', channel: 'push' as const, status: 'delivered' as const },
      { id: 'nf_push_2', channel: 'push' as const, status: 'delivered' as const },
      { id: 'nf_push_3', channel: 'push' as const, status: 'delivered' as const },
      { id: 'nf_push_4', channel: 'push' as const, status: 'delivered' as const },
      { id: 'nf_push_5', channel: 'push' as const, status: 'delivered' as const },
      { id: 'nf_gw_1', channel: 'gateway' as const, status: 'sent' as const },
      { id: 'nf_gw_2', channel: 'gateway' as const, status: 'sent' as const },
    ];
    for (const nf of notifFixture) {
      await db.insert(notifications).values({
        id: nf.id,
        incidentId: 'inc_1',
        recipientType: nf.channel === 'gateway' ? 'gateway_112' : 'contact',
        recipientRef: 'ref_1',
        channel: nf.channel,
        status: nf.status,
        attempts: 1,
        lastError: nf.status === 'failed' ? 'Simulated SMS error' : null,
        createdAt: '2026-10-02T10:00:07.000Z',
      });
    }

    // Seed 7 safety pulses: 5 in 2026-W40 (2026-10-01..2026-10-04) and 2 in 2026-W41 (2026-10-05..2026-10-06)
    await db.insert(safetyPulses).values([
      {
        id: 'sp_1',
        userId: null,
        safetyScore: 5,
        avoidedGoingSomewhere: false,
        createdAt: '2026-10-01',
      },
      {
        id: 'sp_2',
        userId: demoUserId,
        safetyScore: 4,
        avoidedGoingSomewhere: true,
        createdAt: '2026-10-02T09:00:00.000Z',
      },
      {
        id: 'sp_3',
        userId: null,
        safetyScore: 4,
        avoidedGoingSomewhere: false,
        createdAt: '2026-10-03',
      },
      {
        id: 'sp_4',
        userId: null,
        safetyScore: 3,
        avoidedGoingSomewhere: true,
        createdAt: '2026-10-03',
      },
      {
        id: 'sp_5',
        userId: null,
        safetyScore: 2,
        avoidedGoingSomewhere: false,
        createdAt: '2026-10-04',
      },
      {
        id: 'sp_6',
        userId: null,
        safetyScore: 5,
        avoidedGoingSomewhere: false,
        createdAt: '2026-10-05',
      },
      {
        id: 'sp_7',
        userId: null,
        safetyScore: 3,
        avoidedGoingSomewhere: true,
        createdAt: '2026-10-06',
      },
    ]);

    const res = await adminAgent.get(
      '/api/admin/metrics?from=2026-10-01&to=2026-10-06'
    );
    expect(res.status).toBe(200);

    // Ensure no individual user/incident/location rows are leaked anywhere in the response
    const rawJsonStr = JSON.stringify(res.body);
    expect(rawJsonStr).not.toContain(demoUserId);
    expect(rawJsonStr).not.toContain('+919000000001');
    expect(rawJsonStr).not.toContain('28.6139');
    expect(rawJsonStr).not.toContain('is_duress');

    const m = res.body.metrics;

    // 1. Alert-initiation time: median([1, 2, 3, 4, 8, 9]) = 3.5s (n=6); queued_then_delivered reported separately (n=2, insufficient_data=true)
    expect(m.alert_initiation_time.value).toBe(3.5);
    expect(m.alert_initiation_time.n).toBe(6);
    expect(m.alert_initiation_time.excluded_implausible).toBe(0);
    expect(m.alert_initiation_time.target).toBe('under 10 s');
    expect(m.alert_initiation_time.insufficient_data).toBe(false);
    expect(m.alert_initiation_time.queued_then_delivered).toEqual({
      label: 'queued-then-delivered',
      n: 2,
      value: null,
      insufficient_data: true,
    });

    // 2. Time to active: median([5, 5, 5, 6, 7, 8]) = 5.5s (n=6, informational)
    expect(m.time_to_active.value).toBe(5.5);
    expect(m.time_to_active.n).toBe(6);
    expect(m.time_to_active.informational).toBe(true);
    expect(m.time_to_active.insufficient_data).toBe(false);

    // 3. Notification delivery rate: 11 / 12 = 91.67% overall; SMS = 80% (n=5), Push = 100% (n=5), Gateway = null (n=2 < 5)
    expect(m.notification_delivery_rate.value).toBe(91.67);
    expect(m.notification_delivery_rate.n).toBe(12);
    expect(m.notification_delivery_rate.target).toBe('above 95%');
    expect(m.notification_delivery_rate.environment_label).toBe(
      'test environment'
    );
    expect(m.notification_delivery_rate.by_channel.sms.value).toBe(80);
    expect(m.notification_delivery_rate.by_channel.sms.n).toBe(5);
    expect(m.notification_delivery_rate.by_channel.push.value).toBe(100);
    expect(m.notification_delivery_rate.by_channel.push.n).toBe(5);
    expect(m.notification_delivery_rate.by_channel.gateway.value).toBeNull();
    expect(
      m.notification_delivery_rate.by_channel.gateway.insufficient_data
    ).toBe(true);

    // 4. Time to first acknowledgement: median([20, 30, 40, 50, 90]) = 40s, p90 = 90s (n=5)
    expect(m.time_to_first_acknowledgement.value).toBe(40);
    expect(m.time_to_first_acknowledgement.median_seconds).toBe(40);
    expect(m.time_to_first_acknowledgement.p90_seconds).toBe(90);
    expect(m.time_to_first_acknowledgement.n).toBe(5);
    expect(m.time_to_first_acknowledgement.insufficient_data).toBe(false);

    // 5. Time to resolution: median([120, 150, 180, 240, 300]) = 180s (n=5)
    expect(m.time_to_resolution.value).toBe(180);
    expect(m.time_to_resolution.n).toBe(5);
    expect(m.time_to_resolution.insufficient_data).toBe(false);

    // 6. Cancellation rate (2 / 8 = 25%) & False-alarm rate (1 / 6 = 16.67%)
    expect(m.cancellation_rate.value).toBe(25);
    expect(m.cancellation_rate.n).toBe(8);
    expect(m.false_alarm_rate.value).toBe(16.67);
    expect(m.false_alarm_rate.n).toBe(6);

    // 7. Location availability: 5 / 6 = 83.33%, median accuracy = 12m, consent off count = 1
    expect(m.location_availability.value).toBe(83.33);
    expect(m.location_availability.n).toBe(6);
    expect(m.location_availability.median_accuracy_meters).toBe(12);
    expect(m.location_availability.location_consent_off_count).toBe(1);

    // 8. Audit completeness: 7 / 8 = 87.5%, target = 100%
    expect(m.audit_completeness.value).toBe(87.5);
    expect(m.audit_completeness.n).toBe(8);
    expect(m.audit_completeness.target).toBe('100%');

    // 9. Safety pulse: overall n=7 -> avg 3.71, avoided 42.86%; 2026-W40 (n=5) -> avg 3.6, avoided 40%; 2026-W41 (n=2) -> insufficient_data
    expect(m.safety_pulse.value).toBe(3.71);
    expect(m.safety_pulse.average_score).toBe(3.71);
    expect(m.safety_pulse.avoided_going_somewhere_percent).toBe(42.86);
    expect(m.safety_pulse.n).toBe(7);
    expect(m.safety_pulse.by_week).toEqual([
      {
        week: '2026-W40',
        week_start: '2026-09-28',
        n: 5,
        value: 3.6,
        average_score: 3.6,
        avoided_going_somewhere_percent: 40,
        insufficient_data: false,
      },
      {
        week: '2026-W41',
        week_start: '2026-10-05',
        n: 2,
        value: null,
        average_score: null,
        avoided_going_somewhere_percent: null,
        insufficient_data: true,
      },
    ]);

    // 10. Post-incident trust score: (5 + 4 + 5 + 3 + 4) / 5 = 4.2 (n=5)
    expect(m.post_incident_trust_score.value).toBe(4.2);
    expect(m.post_incident_trust_score.n).toBe(5);
    expect(m.post_incident_trust_score.insufficient_data).toBe(false);

    // Verify GET /api/admin/metrics.csv matches JSON values row-by-row
    const csvRes = await adminAgent.get(
      '/api/admin/metrics.csv?from=2026-10-01&to=2026-10-06'
    );
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers['content-type']).toContain('text/csv');

    const lines = csvRes.text.trim().split('\n');
    expect(lines[0]).toBe('metric,value,n,target,formula,insufficient_data');
    expect(lines.length).toBe(12); // header + 11 metric rows

    const expectedKeys = [
      'alert_initiation_time',
      'time_to_active',
      'notification_delivery_rate',
      'time_to_first_acknowledgement',
      'time_to_resolution',
      'cancellation_rate',
      'false_alarm_rate',
      'location_availability',
      'audit_completeness',
      'safety_pulse',
      'post_incident_trust_score',
    ];

    for (let idx = 0; idx < expectedKeys.length; idx++) {
      const key = expectedKeys[idx];
      const jsonEntry = m[key];
      const rowText = lines[idx + 1];
      expect(rowText.startsWith(`${jsonEntry.metric},${jsonEntry.value},${jsonEntry.n},`)).toBe(true);
      expect(rowText.endsWith(`,${jsonEntry.insufficient_data}`)).toBe(true);
    }
  });

  it('4. Clock skew: excludes implausible initiation values (negative or > 300 seconds) from initiation-time median and reports excluded_implausible count', async () => {
    const app = createApp();
    const { userId: demoUserId } = await loginAs(app, '+919000000001');
    const { agent: adminAgent } = await loginAs(app, '+919000000003');

    /*
     * Hand-computed clock-skew fixture (7 online incidents):
     * - 5 valid online durations: [1, 2, 4, 6, 8] s -> median (n=5) = 4 s
     * - 1 negative duration (client_created_at 15s AFTER server created_at: -15 s) -> excluded
     * - 1 > 300s duration (client_created_at 450s BEFORE server created_at: +450 s) -> excluded
     * Expected: n = 5, value = 4, excluded_implausible = 2
     */
    const cases = [
      {
        id: 'inc_skew_1',
        clientCreatedAt: '2026-10-03T10:00:00.000Z',
        createdAt: '2026-10-03T10:00:01.000Z', // 1s
      },
      {
        id: 'inc_skew_2',
        clientCreatedAt: '2026-10-03T10:01:00.000Z',
        createdAt: '2026-10-03T10:01:02.000Z', // 2s
      },
      {
        id: 'inc_skew_3',
        clientCreatedAt: '2026-10-03T10:02:00.000Z',
        createdAt: '2026-10-03T10:02:04.000Z', // 4s
      },
      {
        id: 'inc_skew_4',
        clientCreatedAt: '2026-10-03T10:03:00.000Z',
        createdAt: '2026-10-03T10:03:06.000Z', // 6s
      },
      {
        id: 'inc_skew_5',
        clientCreatedAt: '2026-10-03T10:04:00.000Z',
        createdAt: '2026-10-03T10:04:08.000Z', // 8s
      },
      {
        id: 'inc_skew_neg',
        clientCreatedAt: '2026-10-03T10:05:15.000Z',
        createdAt: '2026-10-03T10:05:00.000Z', // -15s (negative clock skew -> excluded)
      },
      {
        id: 'inc_skew_high',
        clientCreatedAt: '2026-10-03T10:00:00.000Z',
        createdAt: '2026-10-03T10:07:30.000Z', // 450s (> 300s clock skew -> excluded)
      },
    ];

    for (const c of cases) {
      await db.insert(incidents).values({
        id: c.id,
        userId: demoUserId,
        status: 'CANCELLED',
        emergencyType: null,
        clientRequestId: `req_${c.id}`,
        clientCreatedAt: c.clientCreatedAt,
        queuedOffline: false,
        createdAt: c.createdAt,
        activatedAt: null,
        closedAt: c.createdAt,
        mergedIntoId: null,
        sourceTrigger: 'button',
        isDuress: false,
      });
    }

    const res = await adminAgent.get(
      '/api/admin/metrics?from=2026-10-01&to=2026-10-06'
    );
    expect(res.status).toBe(200);
    const initMetric = res.body.metrics.alert_initiation_time;
    expect(initMetric.n).toBe(5);
    expect(initMetric.value).toBe(4);
    expect(initMetric.excluded_implausible).toBe(2);
    expect(initMetric.insufficient_data).toBe(false);
  });

  it('5. Privacy scan: metrics JSON and CSV contain no incident IDs, user IDs, phone numbers, names, or coordinates from the fixture', async () => {
    const app = createApp();
    const { userId: demoUserId } = await loginAs(app, '+919000000001');
    const { agent: adminAgent, userId: adminUserId } = await loginAs(
      app,
      '+919000000003'
    );

    const incId = 'inc_priv_scan_99';
    await db.insert(incidents).values({
      id: incId,
      userId: demoUserId,
      status: 'RESOLVED',
      emergencyType: 'unsafe',
      clientRequestId: 'req_priv_scan_99',
      clientCreatedAt: '2026-10-04T10:00:00.000Z',
      queuedOffline: false,
      createdAt: '2026-10-04T10:00:02.000Z',
      activatedAt: '2026-10-04T10:00:07.000Z',
      closedAt: '2026-10-04T10:05:07.000Z',
      mergedIntoId: null,
      sourceTrigger: 'button',
      isDuress: false,
    });

    await db.insert(locationSamples).values({
      id: 'loc_priv_scan_99',
      incidentId: incId,
      lat: 19.07609,
      lng: 72.877426,
      accuracyM: 14,
      capturedAt: '2026-10-04T10:00:08.000Z',
      expiresAt: Date.now() + 86400000,
    });

    const jsonRes = await adminAgent.get(
      '/api/admin/metrics?from=2026-10-01&to=2026-10-06'
    );
    expect(jsonRes.status).toBe(200);
    const csvRes = await adminAgent.get(
      '/api/admin/metrics.csv?from=2026-10-01&to=2026-10-06'
    );
    expect(csvRes.status).toBe(200);

    const serializedJson = JSON.stringify(jsonRes.body);
    const serializedCsv = csvRes.text;

    const forbiddenTokens = [
      incId,
      'req_priv_scan_99',
      'loc_priv_scan_99',
      demoUserId,
      adminUserId,
      '+919000000001',
      '+919000000002',
      '+919000000003',
      'Aarohi',
      'Sharma',
      'Kavita',
      'Meera',
      '19.07609',
      '72.877426',
      '"incident_id"',
      '"user_id"',
      '"phone_e164"',
      '"lat"',
      '"lng"',
    ];

    for (const token of forbiddenTokens) {
      expect(serializedJson).not.toContain(token);
      expect(serializedCsv).not.toContain(token);
    }
  });
});
