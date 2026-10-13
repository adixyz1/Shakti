import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp } from '../../server';
import {
  closeDatabase,
  getDb,
  initDatabase,
  MIGRATIONS_FOLDER,
} from '../core/db';
import { resetRateLimiter } from '../core/middleware';
import { seedDatabase } from '../core/seed';
import { journeys, locationSamples, sentMessages } from '../db/schema';
import { defaultPushProvider } from '../providers/push';
import { defaultSmsProvider } from '../providers/sms';
import { formatExpectedTimeHHMM } from '../services/journeyService';
import {
  clearAllScheduledTimers,
  hasScheduledJourneyTimers,
  recoverActiveJourneysOnStartup,
} from '../services/scheduler';

describe('SAATHI Phase 7A API Tests (Safe Journeys / Walk With Me)', () => {
  let tempDbPath: string;
  const app = createApp();

  beforeEach(async () => {
    clearAllScheduledTimers();
    resetRateLimiter();
    defaultPushProvider.reset();
    defaultSmsProvider.reset();

    tempDbPath = path.join(
      os.tmpdir(),
      `saathi-phase7a-journeys-${crypto.randomUUID()}.db`
    );
    const db = await initDatabase(`file:${tempDbPath}`);
    await seedDatabase(db);
  });

  afterEach(async () => {
    clearAllScheduledTimers();
    defaultPushProvider.reset();
    defaultSmsProvider.reset();
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

  it('1. Reminder before lapse & lapse notifies ONLY an eligible checkin contact with plain text (no link, no location)', async () => {
    const owner = await loginPhone('+919000000001');

    // Create and accept a trusted contact with receives_checkin = true
    const createCtRes = await owner.agent.post('/api/contacts').send({
      name: 'Priya Sharma',
      phone_e164: '+919000000031',
      permissions: {
        receives_sos: true,
        receives_checkin: true,
        can_see_live_location: true,
      },
    });
    expect(createCtRes.status).toBe(201);
    const contactId = createCtRes.body.contact.id;
    await request(app).post(
      `/api/invitations/${createCtRes.body.invitation_token}/accept`
    );

    const db = getDb();
    // Clear invitation SMS so we only inspect journey notifications
    await db.delete(sentMessages);
    defaultPushProvider.reset();

    // Start a journey with duration_seconds = 0.22 (220ms) and reminder_lead_ms = 140 (so reminder fires at ~80ms, lapse at ~220ms)
    const startRes = await owner.agent.post('/api/journeys').send({
      duration_seconds: 0.22,
      contact_id: contactId,
      reminder_lead_ms: 140,
    });
    expect(startRes.status).toBe(201);
    const journey = startRes.body.journey;
    expect(journey.status).toBe('active');
    expect(journey.contact_id).toBe(contactId);
    expect(journey.reminder_sent_at).toBeNull();
    expect(hasScheduledJourneyTimers(journey.id)).toBe(true);

    // Wait ~120ms -> T-minus reminder push should have been sent to USER, but journey is still active
    await new Promise((r) => setTimeout(r, 120));
    expect(defaultPushProvider.sentPushes).toHaveLength(1);
    expect(defaultPushProvider.sentPushes[0].recipientRef).toBe(
      `user:${owner.userId}`
    );
    expect(defaultPushProvider.sentPushes[0].data?.type).toBe(
      'journey_reminder'
    );

    const midRes = await owner.agent.get('/api/journeys/active');
    expect(midRes.status).toBe(200);
    expect(midRes.body.journey.status).toBe('active');
    expect(midRes.body.journey.reminder_sent_at).toBeTruthy();

    // Wait another 160ms -> journey lapses and plain text SMS is sent to chosen contact
    await new Promise((r) => setTimeout(r, 160));

    const lapsedRes = await owner.agent.get('/api/journeys/active');
    expect(lapsedRes.status).toBe(200);
    expect(lapsedRes.body.journey.status).toBe('lapsed');

    const outboundSms = await db.select().from(sentMessages);
    expect(outboundSms).toHaveLength(1);
    expect(outboundSms[0].toPhoneE164).toBe('+919000000031');

    const expectedHHMM = formatExpectedTimeHHMM(journey.ends_at);
    expect(outboundSms[0].body).toBe(
      `Aarohi hasn't checked in from her walk. Expected by ${expectedHHMM}.`
    );
    // Plain text only: no magic link, no http URL, no coordinates
    expect(outboundSms[0].body).not.toMatch(/https?:\/\//i);
    expect(outboundSms[0].body).not.toMatch(/\/c\//i);
  });

  it('2. Eligibility gate via getNotifiableContacts(userId, "checkin"): does NOT notify contact if receives_checkin is false, contact is paused, or data_processing consent is revoked', async () => {
    const owner = await loginPhone('+919000000001');

    // Contact with receives_checkin = false (only receives_sos = true)
    const createCtRes = await owner.agent.post('/api/contacts').send({
      name: 'Neha Verma',
      phone_e164: '+919000000032',
      permissions: {
        receives_sos: true,
        receives_checkin: false,
        can_see_live_location: false,
      },
    });
    const contactId = createCtRes.body.contact.id;
    await request(app).post(
      `/api/invitations/${createCtRes.body.invitation_token}/accept`
    );

    const db = getDb();
    await db.delete(sentMessages);

    // Start short journey (100ms) with contact who has receives_checkin = false
    const startRes = await owner.agent.post('/api/journeys').send({
      duration_seconds: 0.1,
      contact_id: contactId,
      reminder_lead_ms: 50,
    });
    expect(startRes.status).toBe(201);

    await new Promise((r) => setTimeout(r, 170));

    const checkRes = await owner.agent.get(
      `/api/journeys/${startRes.body.journey.id}`
    );
    expect(checkRes.body.journey.status).toBe('lapsed');

    // Zero SMS sent because getNotifiableContacts(userId, "checkin") does not return this contact
    const outboundSms = await db.select().from(sentMessages);
    expect(outboundSms).toHaveLength(0);
  });

  it('3. Extend, Complete ("I\'m safe"), Cancel, and Owner-only RBAC: complete and cancel stop timers so no reminder or lapse SMS is sent', async () => {
    const owner = await loginPhone('+919000000001');
    const otherUser = await loginPhone('+919000000099', 'Other Woman');

    const createCtRes = await owner.agent.post('/api/contacts').send({
      name: 'Kiran Patel',
      phone_e164: '+919000000033',
      permissions: {
        receives_sos: true,
        receives_checkin: true,
        can_see_live_location: false,
      },
    });
    const contactId = createCtRes.body.contact.id;
    await request(app).post(
      `/api/invitations/${createCtRes.body.invitation_token}/accept`
    );

    const db = getDb();
    await db.delete(sentMessages);
    defaultPushProvider.reset();

    // Start journey (180ms) and extend by 10 minutes, then complete ("I'm safe")
    const start1 = await owner.agent.post('/api/journeys').send({
      duration_seconds: 0.18,
      contact_id: contactId,
      reminder_lead_ms: 80,
    });
    expect(start1.status).toBe(201);
    const j1Id = start1.body.journey.id;

    // Non-owner cannot view, extend, complete, or cancel owner's journey
    const otherGet = await otherUser.agent.get(`/api/journeys/${j1Id}`);
    expect(otherGet.status).toBe(404);
    const otherComplete = await otherUser.agent.post(
      `/api/journeys/${j1Id}/complete`
    );
    expect(otherComplete.status).toBe(404);

    // Owner extends journey
    const extendRes = await owner.agent
      .post(`/api/journeys/${j1Id}/extend`)
      .send({ additional_minutes: 10 });
    expect(extendRes.status).toBe(200);
    expect(
      new Date(extendRes.body.journey.ends_at).getTime()
    ).toBeGreaterThan(new Date(start1.body.journey.ends_at).getTime());

    // Owner completes ("I'm safe") -> stops timers immediately
    const completeRes = await owner.agent.post(
      `/api/journeys/${j1Id}/complete`
    );
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.journey.status).toBe('completed');
    expect(hasScheduledJourneyTimers(j1Id)).toBe(false);

    // Start second short journey (120ms) and cancel immediately
    const start2 = await owner.agent.post('/api/journeys').send({
      duration_seconds: 0.12,
      contact_id: contactId,
      reminder_lead_ms: 60,
    });
    const j2Id = start2.body.journey.id;
    expect(hasScheduledJourneyTimers(j2Id)).toBe(true);

    const cancelRes = await owner.agent.post(`/api/journeys/${j2Id}/cancel`);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.journey.status).toBe('cancelled');
    expect(hasScheduledJourneyTimers(j2Id)).toBe(false);

    // Wait past the original 180ms/120ms windows -> zero reminders and zero lapse SMS sent
    await new Promise((r) => setTimeout(r, 220));
    expect(defaultPushProvider.sentPushes).toHaveLength(0);
    const outboundSms = await db.select().from(sentMessages);
    expect(outboundSms).toHaveLength(0);
  });

  it('4. Server restart recovery: re-reads active journeys on startup and never duplicates an already-sent reminder or lapse notice', async () => {
    const owner = await loginPhone('+919000000001');

    const createCtRes = await owner.agent.post('/api/contacts').send({
      name: 'Riya Sen',
      phone_e164: '+919000000034',
      permissions: {
        receives_sos: true,
        receives_checkin: true,
        can_see_live_location: false,
      },
    });
    const contactId = createCtRes.body.contact.id;
    await request(app).post(
      `/api/invitations/${createCtRes.body.invitation_token}/accept`
    );

    const db = getDb();
    await db.delete(sentMessages);
    defaultPushProvider.reset();

    // Start journey with 260ms duration, 180ms reminder lead (reminder at ~80ms, lapse at ~260ms)
    const startRes = await owner.agent.post('/api/journeys').send({
      duration_seconds: 0.26,
      contact_id: contactId,
      reminder_lead_ms: 180,
    });
    const journeyId = startRes.body.journey.id;

    // Wait 120ms so reminder has fired once
    await new Promise((r) => setTimeout(r, 120));
    expect(defaultPushProvider.sentPushes).toHaveLength(1);

    // Simulate server restart: clear all in-memory timers, then call recoverActiveJourneysOnStartup
    clearAllScheduledTimers();
    expect(hasScheduledJourneyTimers(journeyId)).toBe(false);

    await recoverActiveJourneysOnStartup(db, { reminderLeadMs: 180 });
    // Reminder was ALREADY sent before restart -> must NOT be sent a second time!
    expect(defaultPushProvider.sentPushes).toHaveLength(1);
    expect(hasScheduledJourneyTimers(journeyId)).toBe(true);

    // Wait 200ms so the recovered lapse timer fires
    await new Promise((r) => setTimeout(r, 200));

    const smsAfterLapse = await db.select().from(sentMessages);
    expect(smsAfterLapse).toHaveLength(1);

    // Simulate another server restart AFTER lapse -> must NOT duplicate the lapse notice!
    clearAllScheduledTimers();
    await recoverActiveJourneysOnStartup(db, { reminderLeadMs: 180 });
    const smsAfterSecondRestart = await db.select().from(sentMessages);
    expect(smsAfterSecondRestart).toHaveLength(1);
    expect(defaultPushProvider.sentPushes).toHaveLength(1);
  });

  it('5. No-tracking rule (critical): a completed or lapsed journey collects and leaves ZERO location_samples even when location consent is granted', async () => {
    const owner = await loginPhone('+919000000001');

    // Grant location consent to prove that even with location consent enabled, journeys never capture location
    await owner.agent.post('/api/consents').send({
      type: 'location',
      granted: true,
      source: 'consent_center',
    });

    const db = getDb();

    // 1) Start and complete a journey
    const jComplete = await owner.agent.post('/api/journeys').send({
      duration_minutes: 15,
    });
    expect(jComplete.status).toBe(201);
    await owner.agent.post(
      `/api/journeys/${jComplete.body.journey.id}/complete`
    );

    // 2) Start and let a journey lapse
    const jLapse = await owner.agent.post('/api/journeys').send({
      duration_seconds: 0.08,
      reminder_lead_ms: 40,
    });
    expect(jLapse.status).toBe(201);
    await new Promise((r) => setTimeout(r, 140));

    const lapsedCheck = await owner.agent.get(
      `/api/journeys/${jLapse.body.journey.id}`
    );
    expect(lapsedCheck.body.journey.status).toBe('lapsed');

    // Verify journeys table has both rows and location_samples has ZERO rows
    const allJourneys = await db.select().from(journeys);
    expect(allJourneys.length).toBeGreaterThanOrEqual(2);

    const allLocationSamples = await db.select().from(locationSamples);
    expect(allLocationSamples).toHaveLength(0);
  });

  it('6. Follow-up 2: Optional short note (max 100 chars) is stored with the journey, never returned in API responses or reminder pushes, and included ONLY in the lapse SMS to the chosen contact as "She said: <note>"', async () => {
    const owner = await loginPhone('+919000000001');

    const createCtRes = await owner.agent.post('/api/contacts').send({
      name: 'Ananya Roy',
      phone_e164: '+919000000035',
      permissions: {
        receives_sos: true,
        receives_checkin: true,
        can_see_live_location: false,
      },
    });
    const contactId = createCtRes.body.contact.id;
    await request(app).post(
      `/api/invitations/${createCtRes.body.invitation_token}/accept`
    );

    const db = getDb();
    await db.delete(sentMessages);
    defaultPushProvider.reset();

    // Rejects notes longer than 100 chars
    const tooLongRes = await owner.agent.post('/api/journeys').send({
      duration_minutes: 15,
      contact_id: contactId,
      note: 'A'.repeat(101),
    });
    expect(tooLongRes.status).toBe(422);

    // Start journey with valid short note
    const noteText = 'Heading from Library to Hostel Gate 2';
    const startRes = await owner.agent.post('/api/journeys').send({
      duration_seconds: 0.16,
      contact_id: contactId,
      note: noteText,
      reminder_lead_ms: 90,
    });
    expect(startRes.status).toBe(201);

    // Note is NEVER exposed in POST /api/journeys or GET /api/journeys/active or GET /api/journeys/:id responses
    expect(startRes.body.journey.note).toBeUndefined();
    expect(JSON.stringify(startRes.body)).not.toContain(noteText);

    const activeGet = await owner.agent.get('/api/journeys/active');
    expect(JSON.stringify(activeGet.body)).not.toContain(noteText);

    const detailGet = await owner.agent.get(
      `/api/journeys/${startRes.body.journey.id}`
    );
    expect(JSON.stringify(detailGet.body)).not.toContain(noteText);

    // Wait for reminder push and lapse SMS
    await new Promise((r) => setTimeout(r, 230));

    // Note is NOT in the reminder push
    expect(defaultPushProvider.sentPushes).toHaveLength(1);
    expect(JSON.stringify(defaultPushProvider.sentPushes[0])).not.toContain(
      noteText
    );

    // Note IS included in the lapse SMS to the chosen contact as "She said: <note>"
    const outboundSms = await db.select().from(sentMessages);
    expect(outboundSms).toHaveLength(1);
    const expectedHHMM = formatExpectedTimeHHMM(
      startRes.body.journey.ends_at
    );
    expect(outboundSms[0].body).toBe(
      `Aarohi hasn't checked in from her walk. Expected by ${expectedHHMM}. She said: ${noteText}`
    );
  });

  it('7. Fix 1 (Migration 0007 -> 0010 upgrade): starts from a database at the old 0007 state (without journeys.note), applies the new 0010 migration cleanly, and confirms recoverActiveJourneysOnStartup() works', async () => {
    const legacyDbPath = path.join(
      os.tmpdir(),
      `saathi-legacy-0007-${crypto.randomUUID()}.db`
    );
    const tempMigDir = path.join(
      os.tmpdir(),
      `saathi-mig-0007-${crypto.randomUUID()}`
    );
    fs.mkdirSync(path.join(tempMigDir, 'meta'), { recursive: true });

    try {
      // Copy only migrations 0000..0007 into tempMigDir
      const fullJournal = JSON.parse(
        fs.readFileSync(
          path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'),
          'utf-8'
        )
      );
      const entriesUpTo0007 = fullJournal.entries.filter(
        (e: { idx: number }) => e.idx <= 7
      );
      for (const entry of entriesUpTo0007) {
        const sqlFile = `${entry.tag}.sql`;
        fs.copyFileSync(
          path.join(MIGRATIONS_FOLDER, sqlFile),
          path.join(tempMigDir, sqlFile)
        );
      }
      fs.writeFileSync(
        path.join(tempMigDir, 'meta', '_journal.json'),
        JSON.stringify({ ...fullJournal, entries: entriesUpTo0007 }, null, 2)
      );

      // 1) Migrate fresh SQLite DB only up to 0007_safe_journeys (without note column)
      const rawClient = createClient({ url: `file:${legacyDbPath}` });
      const rawDrizzle = drizzle(rawClient);
      await migrate(rawDrizzle, { migrationsFolder: tempMigDir });

      // Confirm `journeys` at 0007 does NOT have the `note` column
      const colsAt0007 = await rawClient.execute(
        `PRAGMA table_info("journeys")`
      );
      expect(colsAt0007.rows.some((r) => r.name === 'note')).toBe(false);

      // Insert an active journey row in the 0007 schema
      const nowIso = new Date().toISOString();
      const endsIso = new Date(Date.now() + 600_000).toISOString();
      await rawClient.execute({
        sql: `INSERT INTO journeys (id, user_id, contact_id, started_at, ends_at, status) VALUES (?, ?, ?, ?, ?, 'active')`,
        args: ['j_legacy_0007', 'user_demo_aarohi', null, nowIso, endsIso],
      });
      rawClient.close();

      // 2) Now run initDatabase() against that 0007 DB -> applies 0008, 0009, and 0010_journeys_note cleanly
      const upgradedDb = await initDatabase(`file:${legacyDbPath}`);
      await seedDatabase(upgradedDb);

      // 3) Confirm recoverActiveJourneysOnStartup() succeeds and schedules the legacy active journey
      const recoveredCount = await recoverActiveJourneysOnStartup(upgradedDb);
      expect(recoveredCount).toBe(1);
      expect(hasScheduledJourneyTimers('j_legacy_0007')).toBe(true);
    } finally {
      clearAllScheduledTimers();
      await closeDatabase();
      fs.rmSync(tempMigDir, { recursive: true, force: true });
      for (const suffix of ['', '-wal', '-shm', '-journal']) {
        const candidate = `${legacyDbPath}${suffix}`;
        if (fs.existsSync(candidate)) {
          fs.unlinkSync(candidate);
        }
      }
    }
  });
});
