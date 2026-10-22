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
import { consents, contactInvitations, users } from '../db/schema';
import { getNotifiableContacts } from '../services/contactService';

describe('SAATHI Phase 2 API Tests (Consents, Trusted Contacts, Invitations & Rule Enforcement)', () => {
  let tempDbPath: string;
  const app = createApp();

  beforeEach(async () => {
    resetRateLimiter();
    tempDbPath = path.join(
      os.tmpdir(),
      `saathi-phase2-test-${crypto.randomUUID()}.db`
    );
    const db = await initDatabase(`file:${tempDbPath}`);
    await seedDatabase(db);
  });

  afterEach(async () => {
    await closeDatabase();
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const candidate = `${tempDbPath}${suffix}`;
      if (fs.existsSync(candidate)) {
        fs.unlinkSync(candidate);
      }
    }
  });

  async function loginDemoUser() {
    const agent = request.agent(app);
    agent.set('Origin', 'http://localhost:3000');
    const phone = '+919000000001';
    const otpRes = await agent
      .post('/api/auth/otp/request')
      .send({ phone_e164: phone });
    const verifyRes = await agent
      .post('/api/auth/otp/verify')
      .send({ phone_e164: phone, code: (otpRes.body.dev_mock_hint || (defaultOtpProvider as any).lastOtpCode || "000000")});
    return { agent, userId: verifyRes.body.id as string };
  }

  it('maintains a strictly append-only consent ledger (grant/revoke appends rows, never updates/deletes)', async () => {
    const { agent, userId } = await loginDemoUser();

    // Initially demo user has seeded data_processing consent = true, location = false
    const initial = await agent.get('/api/consents');
    expect(initial.status).toBe(200);
    expect(initial.body.current.data_processing).toBe(true);
    expect(initial.body.current.location).toBe(false);
    expect(initial.body.history).toHaveLength(1);
    expect(initial.body.history[0].type).toBe('data_processing');
    expect(initial.body.history[0].source).toBe('seed');

    // 1. Grant location consent
    const grantRes = await agent.post('/api/consents').send({
      type: 'location',
      granted: true,
      source: 'consent_center',
    });
    expect(grantRes.status).toBe(201);
    expect(grantRes.body.current.location).toBe(true);
    expect(grantRes.body.history).toHaveLength(2);

    // 2. Revoke location consent
    const revokeRes = await agent.post('/api/consents').send({
      type: 'location',
      granted: false,
      source: 'consent_center',
    });
    expect(revokeRes.status).toBe(201);
    expect(revokeRes.body.current.location).toBe(false);
    expect(revokeRes.body.history).toHaveLength(3);

    // 3. Re-grant location consent
    const regrantRes = await agent.post('/api/consents').send({
      type: 'location',
      granted: true,
      source: 'onboarding',
    });
    expect(regrantRes.status).toBe(201);
    expect(regrantRes.body.current.location).toBe(true);
    expect(regrantRes.body.history).toHaveLength(4);

    // Verify all 4 rows exist in SQLite table (1 seeded + 3 appended)
    const db = getDb();
    const dbRows = await db
      .select()
      .from(consents)
      .where(eq(consents.userId, userId));
    expect(dbRows).toHaveLength(4);
  });

  it('enforces getNotifiableContacts: excludes invited/paused/removed/permission-off and stops eligibility instantly on revoke', async () => {
    const { agent, userId } = await loginDemoUser();

    // Grant location and data_processing consents
    await agent.post('/api/consents').send({
      type: 'data_processing',
      granted: true,
      source: 'consent_center',
    });
    await agent.post('/api/consents').send({
      type: 'location',
      granted: true,
      source: 'consent_center',
    });

    // Create 4 contacts with different configurations
    const c1Res = await agent.post('/api/contacts').send({
      name: 'Priya (Accepted All)',
      phone_e164: '+919800000001',
      permissions: {
        receives_sos: true,
        receives_checkin: true,
        can_see_live_location: true,
      },
    });
    const c2Res = await agent.post('/api/contacts').send({
      name: 'Neha (Invited Only - Not Accepted)',
      phone_e164: '+919800000002',
      permissions: {
        receives_sos: true,
        receives_checkin: true,
        can_see_live_location: true,
      },
    });
    const c3Res = await agent.post('/api/contacts').send({
      name: 'Riya (Accepted but SOS permission OFF)',
      phone_e164: '+919800000003',
      permissions: {
        receives_sos: false,
        receives_checkin: true,
        can_see_live_location: false,
      },
    });
    const c4Res = await agent.post('/api/contacts').send({
      name: 'Suman (Accepted then Paused)',
      phone_e164: '+919800000004',
      permissions: {
        receives_sos: true,
        receives_checkin: true,
        can_see_live_location: true,
      },
    });

    // Accept c1, c3, and c4 via public invitation endpoint; leave c2 as 'invited'
    await request(app).post(
      `/api/invitations/${c1Res.body.invitation_token}/accept`
    );
    await request(app).post(
      `/api/invitations/${c3Res.body.invitation_token}/accept`
    );
    await request(app).post(
      `/api/invitations/${c4Res.body.invitation_token}/accept`
    );

    // Pause c4
    await agent.post(`/api/contacts/${c4Res.body.contact.id}/pause`);

    // Check getNotifiableContacts for 'sos' -> ONLY c1 should be returned
    const sosEligible = await getNotifiableContacts(userId, 'sos');
    expect(sosEligible.map((c) => c.name)).toEqual(['Priya (Accepted All)']);
    expect(sosEligible.find((c) => c.id === c2Res.body.contact.id)).toBeUndefined();

    // Check getNotifiableContacts for 'checkin' -> c1 and c3
    const checkinEligible = await getNotifiableContacts(userId, 'checkin');
    expect(checkinEligible.map((c) => c.name)).toEqual([
      'Priya (Accepted All)',
      'Riya (Accepted but SOS permission OFF)',
    ]);

    // Check getNotifiableContacts for 'live_location' -> ONLY c1
    const locEligible = await getNotifiableContacts(userId, 'live_location');
    expect(locEligible.map((c) => c.name)).toEqual(['Priya (Accepted All)']);

    // Revoke user's 'location' consent -> live_location eligibility stops INSTANTLY
    await agent.post('/api/consents').send({
      type: 'location',
      granted: false,
      source: 'consent_center',
    });
    const locAfterRevoke = await getNotifiableContacts(userId, 'live_location');
    expect(locAfterRevoke).toHaveLength(0);

    // Revoke c1's receives_sos permission via PATCH -> sos eligibility stops INSTANTLY
    await agent.patch(`/api/contacts/${c1Res.body.contact.id}`).send({
      permissions: {
        receives_sos: false,
        receives_checkin: true,
        can_see_live_location: true,
      },
    });
    const sosAfterContactRevoke = await getNotifiableContacts(userId, 'sos');
    expect(sosAfterContactRevoke).toHaveLength(0);

    // Re-enable c1's receives_sos, then revoke user's data_processing consent -> all eligibility stops INSTANTLY
    await agent.patch(`/api/contacts/${c1Res.body.contact.id}`).send({
      permissions: {
        receives_sos: true,
        receives_checkin: true,
        can_see_live_location: true,
      },
    });
    expect(await getNotifiableContacts(userId, 'sos')).toHaveLength(1);

    await agent.post('/api/consents').send({
      type: 'data_processing',
      granted: false,
      source: 'consent_center',
    });
    expect(await getNotifiableContacts(userId, 'sos')).toHaveLength(0);
    expect(await getNotifiableContacts(userId, 'checkin')).toHaveLength(0);
  });

  it('rejects a 6th active trusted contact (max 5 active per user) and supports reordering and removing', async () => {
    const { agent } = await loginDemoUser();

    const createdIds: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const res = await agent.post('/api/contacts').send({
        name: `Contact ${i}`,
        phone_e164: `+91970000000${i}`,
        permissions: {
          receives_sos: true,
          receives_checkin: true,
          can_see_live_location: false,
        },
      });
      expect(res.status).toBe(201);
      createdIds.push(res.body.contact.id);
    }

    // 6th contact must be rejected with 400
    const sixthRes = await agent.post('/api/contacts').send({
      name: 'Contact 6',
      phone_e164: '+919700000006',
      permissions: {
        receives_sos: true,
        receives_checkin: true,
        can_see_live_location: false,
      },
    });
    expect(sixthRes.status).toBe(400);
    expect(sixthRes.body.detail).toMatch(/Maximum of 5/i);

    // Reorder contacts (reverse order)
    const reversed = [...createdIds].reverse();
    const reorderRes = await agent
      .post('/api/contacts/reorder')
      .send({ ordered_ids: reversed });
    expect(reorderRes.status).toBe(200);
    expect(reorderRes.body.contacts[0].id).toBe(reversed[0]);
    expect(reorderRes.body.contacts[0].priority_order).toBe(1);

    // Remove one contact -> now a new 5th contact is allowed
    const delRes = await agent.delete(`/api/contacts/${reversed[0]}`);
    expect(delRes.status).toBe(200);

    const replacementRes = await agent.post('/api/contacts').send({
      name: 'Contact 6 Replacement',
      phone_e164: '+919700000006',
      permissions: {
        receives_sos: true,
        receives_checkin: true,
        can_see_live_location: false,
      },
    });
    expect(replacementRes.status).toBe(201);
  });

  it('rejects expired invitation tokens and prevents single-use token reuse', async () => {
    const { agent } = await loginDemoUser();

    // 1. Test single-use token reuse rejection
    const c1 = await agent.post('/api/contacts').send({
      name: 'Anita',
      phone_e164: '+919600000001',
      permissions: {
        receives_sos: true,
        receives_checkin: false,
        can_see_live_location: false,
      },
    });
    const token1 = c1.body.invitation_token;

    const inspectRes = await request(app).get(`/api/invitations/${token1}`);
    expect(inspectRes.status).toBe(200);
    expect(inspectRes.body.inviter_name).toBe('Aarohi Sharma');
    expect(inspectRes.body.contact_name).toBe('Anita');
    expect(inspectRes.body.status).toBe('pending');

    const accept1 = await request(app).post(`/api/invitations/${token1}/accept`);
    expect(accept1.status).toBe(200);
    expect(accept1.body.contact.status).toBe('accepted');

    // Second accept or decline with the same token MUST be rejected
    const reuseAccept = await request(app).post(
      `/api/invitations/${token1}/accept`
    );
    expect(reuseAccept.status).toBe(400);
    expect(reuseAccept.body.detail).toMatch(/already been used/i);

    const reuseDecline = await request(app).post(
      `/api/invitations/${token1}/decline`
    );
    expect(reuseDecline.status).toBe(400);

    // 2. Test expired invitation token rejection
    const c2 = await agent.post('/api/contacts').send({
      name: 'Sunita',
      phone_e164: '+919600000002',
      permissions: {
        receives_sos: true,
        receives_checkin: true,
        can_see_live_location: false,
      },
    });
    const token2 = c2.body.invitation_token;

    const db = getDb();
    await db
      .update(contactInvitations)
      .set({ expiresAt: Date.now() - 10_000 })
      .where(eq(contactInvitations.contactId, c2.body.contact.id));

    const expiredAccept = await request(app).post(
      `/api/invitations/${token2}/accept`
    );
    expect(expiredAccept.status).toBe(400);
    expect(expiredAccept.body.detail).toMatch(/expired/i);
  });

  it('writes MockSmsProvider invitations to /api/dev/outbox and returns 404 when NODE_ENV=production', async () => {
    const { agent } = await loginDemoUser();

    await agent.post('/api/contacts').send({
      name: 'Outbox Test Contact',
      phone_e164: '+919500000001',
      permissions: {
        receives_sos: true,
        receives_checkin: true,
        can_see_live_location: true,
      },
    });

    const outboxDev = await request(app).get('/api/dev/outbox');
    expect(outboxDev.status).toBe(200);
    expect(outboxDev.body.provider).toBe('MockSmsProvider');
    expect(outboxDev.body.messages.length).toBeGreaterThanOrEqual(1);
    expect(outboxDev.body.messages[0].to_phone_e164).toBe('+919500000001');
    expect(outboxDev.body.messages[0].metadata.invitation_url).toMatch(
      /^\/invite\/inv_/
    );

    // Simulate NODE_ENV=production -> /api/dev/outbox must return 404
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const outboxProd = await request(app).get('/api/dev/outbox');
      expect(outboxProd.status).toBe(404);
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
    }
  });
});
