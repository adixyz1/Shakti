import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp } from '../../server';
import { closeDatabase, getDb, initDatabase } from '../core/db';
import { resetRateLimiter } from '../core/middleware';
import { seedDatabase } from '../core/seed';
import { safetyPulses } from '../db/schema';
import { resetPulseTracker } from '../services/resourcePulseService';
import { clearAllScheduledTimers } from '../services/scheduler';

describe('SAATHI Phase 7C API Tests (Resources Directory & Weekly Safety Pulse)', () => {
  let tempDbPath: string;
  const app = createApp();

  beforeEach(async () => {
    clearAllScheduledTimers();
    resetRateLimiter();
    resetPulseTracker();

    tempDbPath = path.join(
      os.tmpdir(),
      `saathi-phase7c-resources-pulse-${crypto.randomUUID()}.db`
    );
    const db = await initDatabase(`file:${tempDbPath}`);
    await seedDatabase(db);
  });

  afterEach(async () => {
    clearAllScheduledTimers();
    resetPulseTracker();
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

  it('1. Seeded Resources, Search & Category Filter: seeds 112, 181, One Stop Centre, campus security, legal aid, and counseling (with placeholders only beyond 112/181) and filters by text and category', async () => {
    const listAll = await request(app).get('/api/resources');
    expect(listAll.status).toBe(200);
    expect(listAll.body.resources.length).toBeGreaterThanOrEqual(6);

    const phones = listAll.body.resources.map((r: any) => r.phone);
    expect(phones).toContain('112');
    expect(phones).toContain('181');

    // Verify no invented phone numbers beyond 112 and 181 (all others contain "add your local number")
    for (const r of listAll.body.resources) {
      if (r.phone !== '112' && r.phone !== '181') {
        expect(r.phone.toLowerCase()).toContain('add your local number');
      }
    }

    // Filter by category = women_helpline
    const womenHelplineRes = await request(app).get(
      '/api/resources?category=women_helpline'
    );
    expect(womenHelplineRes.status).toBe(200);
    expect(womenHelplineRes.body.resources).toHaveLength(1);
    expect(womenHelplineRes.body.resources[0].phone).toBe('181');

    // Search by text query q=Sakhi
    const searchRes = await request(app).get('/api/resources?q=Sakhi');
    expect(searchRes.status).toBe(200);
    expect(searchRes.body.resources).toHaveLength(1);
    expect(searchRes.body.resources[0].category).toBe('one_stop_centre');
  });

  it('2. Admin-only Resource Edits: normal users and responders cannot create, update, or delete resources (403); admin can create, update, and delete', async () => {
    const user = await loginPhone('+919000000001');
    const responder = await loginPhone('+919000000002');
    const admin = await loginPhone('+919000000003');

    // Normal user and responder rejected with 403
    const userCreate = await user.agent.post('/api/admin/resources').send({
      name: 'Unauthorized Helpline',
      category: 'counseling',
      phone: 'add your local number',
      description: 'Should fail',
      available_hours: '24x7',
    });
    expect(userCreate.status).toBe(403);

    const respUpdate = await responder.agent
      .put('/api/admin/resources/res_campus_security')
      .send({ name: 'Should fail' });
    expect(respUpdate.status).toBe(403);

    const userDelete = await user.agent.delete(
      '/api/admin/resources/res_campus_security'
    );
    expect(userDelete.status).toBe(403);

    // Admin creates a new resource
    const adminCreate = await admin.agent.post('/api/admin/resources').send({
      name: 'Women Legal Clinic (Local Placeholder)',
      category: 'legal_aid',
      phone: 'add your local number',
      description: 'Campus legal clinic placeholder',
      available_hours: 'Mon-Fri 09:00-17:00',
      active: true,
    });
    expect(adminCreate.status).toBe(201);
    const createdId = adminCreate.body.resource.id;

    // Admin updates resource
    const adminUpdate = await admin.agent
      .put(`/api/admin/resources/${createdId}`)
      .send({
        name: 'Updated Women Legal Clinic',
      });
    expect(adminUpdate.status).toBe(200);
    expect(adminUpdate.body.resource.name).toBe('Updated Women Legal Clinic');

    // Admin deletes resource
    const adminDelete = await admin.agent.delete(
      `/api/admin/resources/${createdId}`
    );
    expect(adminDelete.status).toBe(200);
    expect(adminDelete.body.deleted_id).toBe(createdId);
  });

  it('3. Weekly Safety Pulse & Anonymous Privacy: GET /api/pulse/status and POST /api/pulse enforce at-most-once-a-week per user; anonymous pulse stores NO user_id and ONLY the date (YYYY-MM-DD)', async () => {
    const user1 = await loginPhone('+919000000001');
    const user2 = await loginPhone('+919000000098', 'Second User');
    const db = getDb();

    // Initially user1 should be prompted
    const statusBefore = await user1.agent.get('/api/pulse/status');
    expect(statusBefore.status).toBe(200);
    expect(statusBefore.body.should_prompt).toBe(true);

    // User1 submits an ANONYMOUS pulse
    const anonPulseRes = await user1.agent.post('/api/pulse').send({
      safety_score: 4,
      avoided_going_somewhere: true,
      anonymous: true,
    });
    expect(anonPulseRes.status).toBe(201);
    expect(anonPulseRes.body.pulse.safety_score).toBe(4);
    expect(anonPulseRes.body.pulse.avoided_going_somewhere).toBe(true);
    expect(anonPulseRes.body.pulse.anonymous).toBe(true);
    expect(anonPulseRes.body.pulse.created_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Verify in SQLite that anonymous pulse stored user_id = NULL and created_at = YYYY-MM-DD (no time of day)
    const [anonRow] = await db
      .select()
      .from(safetyPulses)
      .where(eq(safetyPulses.id, anonPulseRes.body.pulse.id));
    expect(anonRow.userId).toBeNull();
    expect(anonRow.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Now GET /api/pulse/status for user1 returns should_prompt = false for the week
    const statusAfter = await user1.agent.get('/api/pulse/status');
    expect(statusAfter.status).toBe(200);
    expect(statusAfter.body.should_prompt).toBe(false);
    expect(statusAfter.body.next_eligible_at).toBeTruthy();

    // Submitting a second pulse within the same week for user1 is rejected with 429
    const duplicatePulse = await user1.agent.post('/api/pulse').send({
      safety_score: 3,
      avoided_going_somewhere: false,
      anonymous: false,
    });
    expect(duplicatePulse.status).toBe(429);

    // User2 submits a NON-ANONYMOUS pulse -> stores user_id and full timestamp, and suppresses future prompt for 7 days
    const namedPulseRes = await user2.agent.post('/api/pulse').send({
      safety_score: 5,
      avoided_going_somewhere: false,
      anonymous: false,
    });
    expect(namedPulseRes.status).toBe(201);
    const [namedRow] = await db
      .select()
      .from(safetyPulses)
      .where(eq(safetyPulses.id, namedPulseRes.body.pulse.id));
    expect(namedRow.userId).toBe(user2.userId);
    expect(namedRow.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    const statusUser2After = await user2.agent.get('/api/pulse/status');
    expect(statusUser2After.body.should_prompt).toBe(false);
  });
});
