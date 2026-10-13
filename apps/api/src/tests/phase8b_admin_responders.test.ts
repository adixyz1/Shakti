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
import { seedDatabase } from '../core/seed';
import { incidentAccessAudit, incidents, responders, users } from '../db/schema';
import { clearAllScheduledTimers } from '../services/scheduler';

describe('Phase 8B Backend: Admin Responder Management (GET & PATCH /api/admin/responders)', () => {
  let db: AppDatabase;
  let tempDbPath: string;

  beforeEach(async () => {
    resetRateLimiter();
    clearAllScheduledTimers();
    tempDbPath = path.join(
      os.tmpdir(),
      `saathi-phase8b-resp-${crypto.randomUUID()}.db`
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
      code: otpReq.body.dev_mock_hint,
    });
    expect(verifyRes.status).toBe(200);
    const [userRow] = await db
      .select()
      .from(users)
      .where(eq(users.phoneE164, phoneE164))
      .limit(1);
    return { agent, userId: userRow.id };
  }

  it('1. Admin-only access control (403 for user and responder) & GET /api/admin/responders returns id, name, organization_zone, active, on_duty without phone numbers or incident data', async () => {
    const app = createApp();
    const { agent: userAgent } = await loginAs(app, '+919000000001');
    const { agent: responderAgent } = await loginAs(app, '+919000000002');
    const { agent: adminAgent } = await loginAs(app, '+919000000003');

    const [seededResp] = await db.select().from(responders).limit(1);
    expect(seededResp).toBeTruthy();

    // User -> 403
    expect((await userAgent.get('/api/admin/responders')).status).toBe(403);
    expect(
      (
        await userAgent
          .patch(`/api/admin/responders/${seededResp.id}`)
          .send({ on_duty: false })
      ).status
    ).toBe(403);

    // Responder -> 403
    expect((await responderAgent.get('/api/admin/responders')).status).toBe(403);
    expect(
      (
        await responderAgent
          .patch(`/api/admin/responders/${seededResp.id}`)
          .send({ on_duty: false })
      ).status
    ).toBe(403);

    // Admin -> 200
    const getRes = await adminAgent.get('/api/admin/responders');
    expect(getRes.status).toBe(200);
    expect(Array.isArray(getRes.body.responders)).toBe(true);
    expect(getRes.body.responders.length).toBeGreaterThanOrEqual(1);

    const first = getRes.body.responders[0];
    expect(first).toEqual({
      id: seededResp.id,
      name: 'Inspector Kavita Rao',
      organization_zone: 'Demo Campus Zone',
      active: true,
      on_duty: true,
    });

    const rawJson = JSON.stringify(getRes.body);
    expect(rawJson).not.toContain('+919000000002');
    expect(rawJson).not.toContain('phone');
    expect(rawJson).not.toContain('incidents');
  });

  it('2. Strict body validation on PATCH /api/admin/responders/:id (400 on extra fields, empty body, or non-boolean values)', async () => {
    const app = createApp();
    const { agent: adminAgent } = await loginAs(app, '+919000000003');
    const [seededResp] = await db.select().from(responders).limit(1);

    // Extra field -> 400
    const extraFieldRes = await adminAgent
      .patch(`/api/admin/responders/${seededResp.id}`)
      .send({ active: false, name: 'Hacked' });
    expect(extraFieldRes.status).toBe(400);

    // Non-boolean value -> 400
    const nonBoolRes = await adminAgent
      .patch(`/api/admin/responders/${seededResp.id}`)
      .send({ on_duty: 'yes' });
    expect(nonBoolRes.status).toBe(400);

    // Empty object -> 400
    const emptyRes = await adminAgent
      .patch(`/api/admin/responders/${seededResp.id}`)
      .send({});
    expect(emptyRes.status).toBe(400);
  });

  it('3. PATCH writes an admin audit entry and returns a warning when leaving an organization with zero active, on-duty responders while an open incident exists', async () => {
    const app = createApp();
    const { userId: demoUserId } = await loginAs(app, '+919000000001');
    const { agent: adminAgent, userId: adminUserId } = await loginAs(
      app,
      '+919000000003'
    );
    const [seededResp] = await db.select().from(responders).limit(1);

    // Create an open ACTIVE incident in Demo Campus Zone
    await db.insert(incidents).values({
      id: 'inc_open_zone_1',
      userId: demoUserId,
      status: 'ACTIVE',
      emergencyType: 'unsafe',
      clientRequestId: 'req_open_zone_1',
      clientCreatedAt: '2026-10-06T10:00:00.000Z',
      queuedOffline: false,
      createdAt: '2026-10-06T10:00:01.000Z',
      activatedAt: '2026-10-06T10:00:06.000Z',
      closedAt: null,
      mergedIntoId: null,
      sourceTrigger: 'button',
      isDuress: false,
    });

    // Turn the only responder in Demo Campus Zone off duty -> still applies, returns warning, writes audit entry, no phone numbers
    const patchRes = await adminAgent
      .patch(`/api/admin/responders/${seededResp.id}`)
      .send({ on_duty: false });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.responder).toEqual({
      id: seededResp.id,
      name: 'Inspector Kavita Rao',
      organization_zone: 'Demo Campus Zone',
      active: true,
      on_duty: false,
    });
    expect(typeof patchRes.body.warning).toBe('string');
    expect(patchRes.body.warning).toContain('zero active, on-duty responders');
    expect(JSON.stringify(patchRes.body)).not.toContain('+919000000002');

    // Verify audit log entry was written
    const audits = await db.select().from(incidentAccessAudit);
    const adminAudit = audits.find(
      (a) =>
        a.actorType === 'admin' &&
        a.actorId === adminUserId &&
        a.action === 'admin_update_responder'
    );
    expect(adminAudit).toBeTruthy();
    expect(adminAudit!.detail).toContain('on_duty: true -> false');

    // Turn back on duty -> warning is null
    const restoreRes = await adminAgent
      .patch(`/api/admin/responders/${seededResp.id}`)
      .send({ on_duty: true });
    expect(restoreRes.status).toBe(200);
    expect(restoreRes.body.responder.on_duty).toBe(true);
    expect(restoreRes.body.warning).toBeNull();
  });
});
