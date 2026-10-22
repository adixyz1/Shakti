import { defaultOtpProvider } from '../providers/otp';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp } from '../../server';
import { config } from '../core/config';
import { closeDatabase, getDb, initDatabase } from '../core/db';
import { resetRateLimiter } from '../core/middleware';
import { seedDatabase } from '../core/seed';
import { reports } from '../db/schema';
import { clearAllScheduledTimers } from '../services/scheduler';

describe('SAATHI Phase 7B API Tests (Reports & K-Anonymized Aggregated Safety Layer)', () => {
  let tempDbPath: string;
  const app = createApp();

  beforeEach(async () => {
    process.env.DEMO_MODE = 'true';
    process.env.DEMO_ADMIN_HINT = 'true';
    clearAllScheduledTimers();
    resetRateLimiter();

    tempDbPath = path.join(
      os.tmpdir(),
      `saathi-phase7b-reports-${crypto.randomUUID()}.db`
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

  it('1. Anonymous report has NO user_id in DB and created_at truncated to DATE (YYYY-MM-DD); non-anonymous stores user_id and full timestamp; coordinates are rounded to 3 decimals', async () => {
    const user = await loginPhone('+919000000001');
    const db = getDb();

    // Submit anonymous report with 6-decimal coordinates
    const anonRes = await user.agent.post('/api/reports').send({
      category: 'poor_lighting',
      lat: 28.613948,
      lng: 77.209021,
      note: 'Streetlights near gate 3 have been out for a week',
      anonymous: true,
    });
    expect(anonRes.status).toBe(201);
    expect(anonRes.body.report.anonymous).toBe(true);
    expect(anonRes.body.report.lat).toBe(28.614);
    expect(anonRes.body.report.lng).toBe(77.209);
    expect(anonRes.body.report.user_id).toBeUndefined();
    // Follow-up 2: anonymous created_at is truncated to YYYY-MM-DD (no time of day)
    expect(anonRes.body.report.created_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Verify directly in SQLite that user_id is NULL, created_at is date-only, and lat/lng are rounded to 3 decimals
    const [anonRow] = await db
      .select()
      .from(reports)
      .where(eq(reports.id, anonRes.body.report.id));
    expect(anonRow.userId).toBeNull();
    expect(anonRow.anonymous).toBe(true);
    expect(anonRow.lat).toBe(28.614);
    expect(anonRow.lng).toBe(77.209);
    expect(anonRow.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Submit non-anonymous report -> stores user_id and full ISO timestamp (includes time of day)
    const namedRes = await user.agent.post('/api/reports').send({
      category: 'broken_cctv',
      lat: 28.615111,
      lng: 77.210888,
      note: 'Camera facing bus stop is disconnected',
      anonymous: false,
    });
    expect(namedRes.status).toBe(201);
    expect(namedRes.body.report.created_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
    );
    const [namedRow] = await db
      .select()
      .from(reports)
      .where(eq(reports.id, namedRes.body.report.id));
    expect(namedRow.userId).toBe(user.userId);
    expect(namedRow.anonymous).toBe(false);
    expect(namedRow.lat).toBe(28.615);
    expect(namedRow.lng).toBe(77.211);
    expect(namedRow.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('2. K-anonymity on GET /api/safety-layer: cells with < K reports (default K=5) are NOT returned; cells with >= K reports ARE returned with aggregated counts only', async () => {
    const user = await loginPhone('+919000000001');

    // Cell A (~28.614, 77.209): submit 4 reports (below K=5) from IP #1
    for (let i = 0; i < 4; i++) {
      const r = await user.agent
        .post('/api/reports')
        .set('X-Forwarded-For', '203.0.113.10')
        .send({
          category: 'poor_lighting',
          lat: 28.61391 + i * 0.00001, // all round to 28.614
          lng: 77.20901 + i * 0.00001, // all round to 77.209
          note: `Private note #${i}`,
          anonymous: true,
        });
      expect(r.status).toBe(201);
    }

    // Cell B (~28.620, 77.215): submit 3 reports (also below K=5) from IP #2
    for (let i = 0; i < 3; i++) {
      const r = await user.agent
        .post('/api/reports')
        .set('X-Forwarded-For', '203.0.113.20')
        .send({
          category: 'unsafe_area',
          lat: 28.62002,
          lng: 77.21502,
          anonymous: true,
        });
      expect(r.status).toBe(201);
    }

    // With 4 reports in Cell A and 3 in Cell B, GET /api/safety-layer (default K=5) returns 0 cells!
    const layerBefore = await user.agent.get('/api/safety-layer');
    expect(layerBefore.status).toBe(200);
    expect(layerBefore.body.k_threshold).toBe(5);
    expect(layerBefore.body.cells).toHaveLength(0);

    // Submit 5th report in Cell A from IP #1 -> now Cell A reaches K=5
    const r5 = await user.agent
      .post('/api/reports')
      .set('X-Forwarded-For', '203.0.113.10')
      .send({
        category: 'harassment',
        lat: 28.61404,
        lng: 77.20899,
        note: 'Fifth report in cell A',
        anonymous: true,
      });
    expect(r5.status).toBe(201);

    const layerAfter = await user.agent.get('/api/safety-layer');
    expect(layerAfter.status).toBe(200);
    expect(layerAfter.body.cells).toHaveLength(1);
    expect(layerAfter.body.cells[0].cell_id).toBe('28.614,77.209');
    expect(layerAfter.body.cells[0].lat).toBe(28.614);
    expect(layerAfter.body.cells[0].lng).toBe(77.209);
    expect(layerAfter.body.cells[0].total_count).toBe(5);
    expect(layerAfter.body.cells[0].categories).toEqual({
      poor_lighting: 4,
      harassment: 1,
    });

    // Individual report notes or IDs are NEVER present in /api/safety-layer
    expect(JSON.stringify(layerAfter.body)).not.toContain('Private note');
    expect(JSON.stringify(layerAfter.body)).not.toContain(
      'Fifth report in cell A'
    );
  });

  it('3. Access control & Moderation: normal users and responders cannot read raw reports (403); admin CAN read GET /api/admin/reports and delete a report via DELETE /api/admin/reports/:id', async () => {
    const user = await loginPhone('+919000000001');
    const responder = await loginPhone('+919000000002');
    const admin = await loginPhone('+919000000003');

    const created = await user.agent.post('/api/reports').send({
      category: 'stalking',
      lat: 28.6139,
      lng: 77.209,
      note: 'Moderation test note',
      anonymous: true,
    });
    expect(created.status).toBe(201);
    const reportId = created.body.report.id;

    // Normal user cannot read raw reports on /api/reports or /api/admin/reports
    const userRaw = await user.agent.get('/api/reports');
    expect(userRaw.status).toBe(403);
    const userAdminRaw = await user.agent.get('/api/admin/reports');
    expect(userAdminRaw.status).toBe(403);
    const userDelete = await user.agent.delete(`/api/admin/reports/${reportId}`);
    expect(userDelete.status).toBe(403);

    // Responder cannot read raw reports on /api/admin/reports
    const responderAdminRaw = await responder.agent.get('/api/admin/reports');
    expect(responderAdminRaw.status).toBe(403);

    // Admin CAN read raw reports on GET /api/admin/reports (and anonymous report still has user_id = null)
    const adminList = await admin.agent.get('/api/admin/reports');
    expect(adminList.status).toBe(200);
    expect(adminList.body.reports).toHaveLength(1);
    expect(adminList.body.reports[0].id).toBe(reportId);
    expect(adminList.body.reports[0].note).toBe('Moderation test note');
    expect(adminList.body.reports[0].user_id).toBeNull();

    // Admin CAN delete a report
    const adminDel = await admin.agent.delete(`/api/admin/reports/${reportId}`);
    expect(adminDel.status).toBe(200);
    expect(adminDel.body.deleted_id).toBe(reportId);

    const adminListAfter = await admin.agent.get('/api/admin/reports');
    expect(adminListAfter.body.reports).toHaveLength(0);
  });

  it('4. Per-minute rate limit on POST /api/reports: enforces reportRateLimitPerMinute (default 10/min per IP) and returns 429 beyond the per-minute limit', async () => {
    const user1 = await loginPhone('+919000000001');
    const user2 = await loginPhone('+919000000091', 'Reporter Two');
    const user3 = await loginPhone('+919000000092', 'Reporter Three');
    const maxPerMin = config.reportRateLimitPerMinute;
    expect(maxPerMin).toBe(10);

    // Use 3 signed-in accounts (4 + 4 + 2 = 10 non-anonymous reports, each under the 5/day per-account daily cap)
    // all sharing the same IP '198.51.100.42' so we hit the 10/min per-IP rate limit specifically
    const agents = [
      user1.agent,
      user1.agent,
      user1.agent,
      user1.agent,
      user2.agent,
      user2.agent,
      user2.agent,
      user2.agent,
      user3.agent,
      user3.agent,
    ];

    for (let i = 0; i < maxPerMin; i++) {
      const res = await agents[i]
        .post('/api/reports')
        .set('X-Forwarded-For', '198.51.100.42')
        .send({
          category: 'poor_lighting',
          lat: 28.614,
          lng: 77.209,
          anonymous: false,
        });
      expect(res.status).toBe(201);
    }

    // 11th request within the same minute from the same IP is rejected by reportRateLimitMiddleware with 429
    const eleventh = await user3.agent
      .post('/api/reports')
      .set('X-Forwarded-For', '198.51.100.42')
      .send({
        category: 'poor_lighting',
        lat: 28.614,
        lng: 77.209,
        anonymous: false,
      });
    expect(eleventh.status).toBe(429);
    expect(eleventh.body.detail).toContain('Too many safety reports submitted');
  });

  it('5. Follow-up 3: Daily cap per reporter (default 5/day: per IP in memory only for anonymous, per account for signed-in) returns 429 beyond the cap', async () => {
    const user = await loginPhone('+919000000001');
    const dailyCap = config.reportDailyCapPerReporter;
    expect(dailyCap).toBe(5);

    // 1) Anonymous daily cap per IP (5 allowed, 6th returns 429)
    for (let i = 0; i < dailyCap; i++) {
      const res = await user.agent
        .post('/api/reports')
        .set('X-Forwarded-For', '198.51.100.77')
        .send({
          category: 'poor_lighting',
          lat: 28.614,
          lng: 77.209,
          anonymous: true,
        });
      expect(res.status).toBe(201);
    }

    const sixthAnonSameIp = await user.agent
      .post('/api/reports')
      .set('X-Forwarded-For', '198.51.100.77')
      .send({
        category: 'poor_lighting',
        lat: 28.614,
        lng: 77.209,
        anonymous: true,
      });
    expect(sixthAnonSameIp.status).toBe(429);

    // Verify IP is never stored on the report rows in SQLite
    const db = getDb();
    const allRows = await db.select().from(reports);
    expect(JSON.stringify(allRows)).not.toContain('198.51.100.77');

    // 2) Signed-in non-anonymous daily cap per account (5 allowed, 6th returns 429)
    for (let i = 0; i < dailyCap; i++) {
      const res = await user.agent
        .post('/api/reports')
        .set('X-Forwarded-For', `198.51.100.${80 + i}`)
        .send({
          category: 'broken_cctv',
          lat: 28.615,
          lng: 77.21,
          anonymous: false,
        });
      expect(res.status).toBe(201);
    }

    const sixthSignedIn = await user.agent
      .post('/api/reports')
      .set('X-Forwarded-For', '198.51.100.99')
      .send({
        category: 'broken_cctv',
        lat: 28.615,
        lng: 77.21,
        anonymous: false,
      });
    expect(sixthSignedIn.status).toBe(429);
  });
});
