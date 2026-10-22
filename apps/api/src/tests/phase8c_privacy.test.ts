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
import { seedDatabase } from '../core/seed';
import {
  consents,
  contactIncidentTokens,
  contactInvitations,
  incidentAccessAudit,
  incidentAssignments,
  incidentEvents,
  incidents,
  journeys,
  locationSamples,
  notifications,
  otpCodes,
  postIncidentRatings,
  reports,
  resources,
  responders,
  safetyPulses,
  sentMessages,
  trustedContacts,
  users,
} from '../db/schema';
import { resetPulseTracker } from '../services/resourcePulseService';
import {
  runLocationRetentionPurge,
  SEVEN_DAYS_MS,
  THIRTY_DAYS_MS,
} from '../services/retentionService';
import {
  activateAndDispatchIncident,
  clearAllScheduledTimers,
} from '../services/scheduler';

describe('Phase 8C: Privacy Tools, Data Export, Account Deletion & Retention Purge (Backend)', () => {
  let db: AppDatabase;
  let tempDbPath: string;

  beforeEach(async () => {
    process.env.DEMO_MODE = 'true';
    process.env.DEMO_ADMIN_HINT = 'true';
    resetRateLimiter();
    clearAllScheduledTimers();
    resetPulseTracker();
    tempDbPath = path.join(
      os.tmpdir(),
      `saathi_phase8c_${crypto.randomUUID()}.db`
    );
    db = await initDatabase(`file:${tempDbPath}`);
    await seedDatabase(db);
  });

  afterEach(async () => {
    clearAllScheduledTimers();
    await closeDatabase();
    if (tempDbPath && fs.existsSync(tempDbPath)) {
      try {
        fs.unlinkSync(tempDbPath);
      } catch {
        // ignore
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
    const code = otpReq.body.dev_mock_hint || (defaultOtpProvider as any).lastOtpCode || '000000';
    const verifyRes = await agent
      .post('/api/auth/otp/verify')
      .send({ phone_e164: phoneE164, code });
    expect(verifyRes.status).toBe(200);
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.phoneE164, phoneE164))
      .limit(1);
    return {
      agent,
      user: {
        ...verifyRes.body,
        id: verifyRes.body.id || row?.id,
      },
    };
  }

  it('1. GET /api/me/export: returns ONLY the signed-in user data, applies duress masking (duress incident appears CANCELLED), excludes anonymous reports/pulses, and never leaks PIN hashes, tokens, or responder notes', async () => {
    const app = createApp();
    const { agent: userAgent, user: demoUser } = await loginAs(
      app,
      '+919000000001'
    );
    const { agent: otherAgent } = await loginAs(app, '+919876500099');
    const { agent: responderAgent } = await loginAs(app, '+919000000002');

    // Configure Cancel PIN and Duress PIN for demoUser
    await userAgent.put('/api/settings/cancel-pin').send({ pin: '1234' });
    await userAgent
      .put('/api/settings/duress-pin')
      .send({ pin: '9999', cancel_pin: '1234' });

    // Grant consents
    await userAgent.post('/api/consents').send({
      type: 'data_processing',
      granted: true,
      source: 'test',
    });
    await userAgent.post('/api/consents').send({
      type: 'location',
      granted: true,
      source: 'test',
    });

    // Add a trusted contact for demoUser and one for otherUser
    const contactRes = await userAgent.post('/api/contacts').send({
      name: 'Priya Sister',
      phone_e164: '+919811122233',
      permissions: {
        receives_sos: true,
        receives_checkin: true,
        can_see_live_location: true,
      },
    });
    expect(contactRes.status).toBe(201);
    const rawInviteToken = contactRes.body.invitation_token;
    await request(app).post(`/api/invitations/${rawInviteToken}/accept`);

    await otherAgent.post('/api/contacts').send({
      name: 'Other Person Secret Contact',
      phone_e164: '+919899988877',
      permissions: {
        receives_sos: true,
        receives_checkin: false,
        can_see_live_location: false,
      },
    });

    // Create an incident for demoUser and cancel with DURESS PIN ('9999')
    const incRes = await userAgent.post('/api/incidents').send({
      client_request_id: 'req_duress_export_1',
      location: { lat: 28.6139, lng: 77.209, accuracy_m: 10 },
    });
    expect(incRes.status).toBe(201);
    const incId = incRes.body.incident.id;

    const cancelRes = await userAgent
      .post(`/api/incidents/${incId}/cancel`)
      .send({ pin: '9999', note: 'Forced to cancel' });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe('CANCELLED');

    // Activate & route the duress incident to responders, then responder adds an internal note
    await activateAndDispatchIncident(incId, db);
    const respNoteRes = await responderAgent
      .post(`/api/responder/incidents/${incId}/note`)
      .send({ note: 'CONFIDENTIAL RESPONDER NOTE: dispatching patrol unit 4' });
    expect(respNoteRes.status).toBe(200);

    // Start and complete a Safe Journey with a note
    const journeyRes = await userAgent.post('/api/journeys').send({
      duration_minutes: 15,
      contact_id: contactRes.body.contact.id,
      note: 'Taking Yellow Line metro home',
    });
    expect(journeyRes.status).toBe(201);
    await userAgent.post(`/api/journeys/${journeyRes.body.journey.id}/complete`);

    // Submit 1 non-anonymous report and 1 anonymous report
    await userAgent.post('/api/reports').send({
      category: 'poor_lighting',
      lat: 28.6139,
      lng: 77.209,
      note: 'My non-anonymous lighting report',
      anonymous: false,
    });
    await userAgent.post('/api/reports').send({
      category: 'stalking',
      lat: 28.62,
      lng: 77.21,
      note: 'My anonymous report that must not be linked',
      anonymous: true,
    });

    // Submit 1 non-anonymous safety pulse
    await userAgent.post('/api/pulse').send({
      safety_score: 4,
      avoided_going_somewhere: false,
      anonymous: false,
    });

    // Export data via GET /api/me/export
    const exportRes = await userAgent.get('/api/me/export');
    expect(exportRes.status).toBe(200);
    expect(exportRes.headers['content-disposition']).toContain(
      'saathi-data-export.json'
    );

    const body = exportRes.body;
    const serialized = JSON.stringify(body);

    // 1. Profile & consents present
    expect(body.profile.id).toBe(demoUser.id);
    expect(body.profile.phone_e164).toBe('+919000000001');
    expect(body.consent_ledger.history.length).toBeGreaterThanOrEqual(2);

    // 2. Contacts she added
    expect(body.trusted_contacts.some((ct: any) => ct.name === 'Priya Sister')).toBe(true);
    const priyaCt = body.trusted_contacts.find((ct: any) => ct.phone_e164 === '+919811122233');
    expect(priyaCt).toBeDefined();
    expect(priyaCt.status).toBe('accepted');

    // 3. Duress incident appears CANCELLED in her export, with no responder notes
    const exportedInc = body.incidents.find((i: any) => i.id === incId);
    expect(exportedInc).toBeDefined();
    expect(exportedInc.status).toBe('CANCELLED');
    expect(exportedInc.activated_at).toBeNull();

    // 4. Journeys and non-anonymous reports/pulses included; anonymous report excluded
    expect(body.journeys).toHaveLength(1);
    expect(body.journeys[0].note).toBe('Taking Yellow Line metro home');
    expect(body.reports).toHaveLength(1);
    expect(body.reports[0].note).toBe('My non-anonymous lighting report');
    expect(body.safety_pulses).toHaveLength(1);
    expect(body.safety_pulses[0].safety_score).toBe(4);

    // 5. Security/privacy checks on serialized export:
    // No other user's data, no anonymous report note, no PIN hashes, no tokens, no responder notes
    expect(serialized).not.toContain('Other Person Secret Contact');
    expect(serialized).not.toContain('+919899988877');
    expect(serialized).not.toContain(
      'My anonymous report that must not be linked'
    );
    expect(serialized).not.toContain('CONFIDENTIAL RESPONDER NOTE');
    expect(serialized).not.toContain('cancelPinHash');
    expect(serialized).not.toContain('duressPinHash');
    expect(serialized).not.toContain('cancel_pin_hash');
    expect(serialized).not.toContain('duress_pin_hash');
    expect(serialized).not.toContain(rawInviteToken);
    expect(serialized).not.toContain('tokenHash');
    expect(serialized).not.toContain('token_hash');
  });

  it('2. DELETE /api/me: requires a fresh OTP ONLY (rejects Cancel PIN) and confirmation="DELETE", deletes all personal rows in one transaction, passes a full 17-table PII scan, leaves a second user untouched, and invalidates sessions', async () => {
    const app = createApp();
    const { agent: userAgent, user: demoUser } = await loginAs(
      app,
      '+919000000001'
    );
    const { agent: secondUserAgent, user: secondUser } = await loginAs(
      app,
      '+919876500222'
    );
    const { agent: adminAgent } = await loginAs(app, '+919000000003');

    // Set Cancel PIN '4321' on demoUser
    await userAgent.put('/api/settings/cancel-pin').send({ pin: '4321' });

    // Grant consents for demoUser and secondUser
    await userAgent.post('/api/consents').send({
      type: 'data_processing',
      granted: true,
      source: 'test',
    });
    await userAgent.post('/api/consents').send({
      type: 'location',
      granted: true,
      source: 'test',
    });
    await secondUserAgent.post('/api/consents').send({
      type: 'data_processing',
      granted: true,
      source: 'test',
    });

    // Add contact for demoUser and contact for secondUser
    const contactRes = await userAgent.post('/api/contacts').send({
      name: 'Meera Contact',
      phone_e164: '+919822233344',
      permissions: {
        receives_sos: true,
        receives_checkin: true,
        can_see_live_location: true,
      },
    });
    const contactId = contactRes.body.contact.id;
    await request(app).post(
      `/api/invitations/${contactRes.body.invitation_token}/accept`
    );

    const secondContactRes = await secondUserAgent.post('/api/contacts').send({
      name: 'Second User Trusted Contact',
      phone_e164: '+919833344455',
      permissions: {
        receives_sos: true,
        receives_checkin: true,
        can_see_live_location: false,
      },
    });
    expect(secondContactRes.status).toBe(201);

    // Second user creates a journey and a report (must remain untouched)
    const secondJourneyRes = await secondUserAgent.post('/api/journeys').send({
      duration_minutes: 30,
      note: 'Second user walk note',
    });
    expect(secondJourneyRes.status).toBe(201);
    const secondReportRes = await secondUserAgent.post('/api/reports').send({
      category: 'poor_lighting',
      lat: 28.615,
      lng: 77.211,
      note: 'Second user report note',
      anonymous: false,
    });
    expect(secondReportRes.status).toBe(201);

    // Trigger and resolve an incident for demoUser with location, notification, rating, and audit entry
    const incRes = await userAgent.post('/api/incidents').send({
      client_request_id: 'req_delete_test_1',
      location: { lat: 28.6139, lng: 77.209, accuracy_m: 12 },
    });
    const incId = incRes.body.incident.id;

    await userAgent
      .post(`/api/incidents/${incId}/resolve`)
      .send({ resolution: 'RESOLVED', note: 'User personal resolution note' });
    await userAgent.post(`/api/incidents/${incId}/rating`).send({ score: 5 });

    // Insert a notification row and an access audit row for this incident to verify scrubbing
    await db.insert(notifications).values({
      id: 'notif_del_1',
      incidentId: incId,
      recipientType: 'contact',
      recipientRef: contactId,
      channel: 'sms',
      status: 'sent',
      attempts: 1,
      lastError: 'some error mentioning +919822233344 and Ananya Sharma',
      createdAt: new Date().toISOString(),
    });
    await db.insert(incidentAccessAudit).values({
      id: 'aud_del_1',
      incidentId: incId,
      actorType: 'contact',
      actorId: contactId,
      actorLabel: 'Meera Contact',
      action: 'contact_link_open',
      detail: 'Meera Contact (+919822233344) viewed link for Ananya Sharma (+919000000001)',
      createdAt: new Date().toISOString(),
    });

    // Create a journey, a non-anonymous report, and a non-anonymous safety pulse for demoUser
    const jRes = await userAgent.post('/api/journeys').send({
      duration_minutes: 20,
      contact_id: contactId,
      note: 'Walking from library',
    });
    await userAgent.post(`/api/journeys/${jRes.body.journey.id}/complete`);

    const repRes = await userAgent.post('/api/reports').send({
      category: 'harassment',
      lat: 28.6139,
      lng: 77.209,
      note: 'Personal report note by Ananya Sharma',
      anonymous: false,
    });
    const reportId = repRes.body.report.id;

    const pulseRes = await userAgent.post('/api/pulse').send({
      safety_score: 3,
      avoided_going_somewhere: true,
      anonymous: false,
    });
    const pulseId = pulseRes.body.pulse.id;

    // 1. Reject DELETE /api/me without confirmation="DELETE"
    const badConfirm = await userAgent
      .delete('/api/me')
      .send({ confirmation: ' wrong ', otp_code: '123456' });
    expect(badConfirm.status).toBe(400);

    // 2. Reject DELETE /api/me without OTP or when attempting to use Cancel PIN
    const noReauth = await userAgent
      .delete('/api/me')
      .send({ confirmation: 'DELETE' });
    expect(noReauth.status).toBe(401);

    const pinAttempt = await userAgent
      .delete('/api/me')
      .send({ confirmation: 'DELETE', cancel_pin: '4321' });
    expect(pinAttempt.status).toBe(400);
    expect(pinAttempt.body.detail).toMatch(/fresh 6-digit OTP/i);

    const wrongOtp = await userAgent
      .delete('/api/me')
      .send({ confirmation: 'DELETE', otp_code: '000000' });
    expect(wrongOtp.status).toBe(401);

    // 3. Request a fresh OTP and succeed with valid OTP + confirmation="DELETE"
    const freshOtpRes = await userAgent
      .post('/api/auth/otp/request')
      .send({ phone_e164: '+919000000001' });
    expect(freshOtpRes.status).toBe(200);
    const freshOtp = freshOtpRes.body.dev_mock_hint;

    const delRes = await userAgent
      .delete('/api/me')
      .send({ confirmation: 'DELETE', otp_code: freshOtp });
    expect(delRes.status).toBe(200);
    expect(delRes.body.status).toBe('account_deleted');

    // (h) Her sessions are invalid after deletion: both /api/me and /api/auth/refresh return 401
    const meAfter = await userAgent.get('/api/me');
    expect(meAfter.status).toBe(401);
    const refreshAfter = await userAgent.post('/api/auth/refresh');
    expect(refreshAfter.status).toBe(401);

    // (f) Full PII SCAN across ALL 17 database tables (including audit_log alias incidentAccessAudit):
    // Verify no trace of demoUser's phone (+919000000001), name (Ananya Sharma), or her contact's phone (+919822233344) / name (Meera Contact)
    const piiScanTables: Record<string, unknown[]> = {
      users: await db.select().from(users),
      otp_codes: await db.select().from(otpCodes),
      consents: await db.select().from(consents),
      trusted_contacts: await db.select().from(trustedContacts),
      contact_invitations: await db.select().from(contactInvitations),
      contact_incident_tokens: await db.select().from(contactIncidentTokens),
      incidents: await db.select().from(incidents),
      incident_events: await db.select().from(incidentEvents),
      location_samples: await db.select().from(locationSamples),
      notifications: await db.select().from(notifications),
      sent_messages: await db.select().from(sentMessages),
      responders: await db.select().from(responders),
      incident_assignments: await db.select().from(incidentAssignments),
      incident_access_audit: await db.select().from(incidentAccessAudit),
      audit_log: await db.select().from(incidentAccessAudit),
      journeys: await db.select().from(journeys),
      reports: await db.select().from(reports),
      resources: await db.select().from(resources),
      safety_pulses: await db.select().from(safetyPulses),
      post_incident_ratings: await db.select().from(postIncidentRatings),
    };

    const forbiddenPiiStrings = [
      '+919000000001',
      'Ananya Sharma',
      '+919822233344',
      'Meera Contact',
      demoUser.id,
      contactId,
    ];

    for (const [tableName, rows] of Object.entries(piiScanTables)) {
      const serializedTable = JSON.stringify(rows);
      for (const pii of forbiddenPiiStrings) {
        expect(
          serializedTable,
          `Table "${tableName}" leaked PII string "${pii}"`
        ).not.toContain(pii);
      }
    }

    // Verify documented retained anonymized fields
    const [anonInc] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, incId));
    expect(anonInc).toBeDefined();
    expect(anonInc.userId).toBe('deleted_user');
    expect(anonInc.status).toBe('RESOLVED');

    const [anonNotif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, 'notif_del_1'));
    expect(anonNotif.recipientRef).toBe('redacted');
    expect(anonNotif.lastError).toBeNull();

    const [anonAudit] = await db
      .select()
      .from(incidentAccessAudit)
      .where(eq(incidentAccessAudit.id, 'aud_del_1'));
    expect(anonAudit.actorId).toBe('redacted');
    expect(anonAudit.actorLabel).toBeNull();
    expect(anonAudit.detail).toBeNull();

    const [anonReport] = await db
      .select()
      .from(reports)
      .where(eq(reports.id, reportId));
    expect(anonReport.userId).toBeNull();
    expect(anonReport.anonymous).toBe(true);
    expect(anonReport.note).toBeNull();
    expect(anonReport.createdAt).toHaveLength(10); // YYYY-MM-DD only

    const [anonPulse] = await db
      .select()
      .from(safetyPulses)
      .where(eq(safetyPulses.id, pulseId));
    expect(anonPulse.userId).toBeNull();
    expect(anonPulse.createdAt).toHaveLength(10); // YYYY-MM-DD only

    // (g) Second user's data is completely untouched
    const [secondUserRow] = await db
      .select()
      .from(users)
      .where(eq(users.id, secondUser.id));
    expect(secondUserRow).toBeDefined();
    expect(secondUserRow.phoneE164).toBe('+919876500222');

    const secondUserContacts = await db
      .select()
      .from(trustedContacts)
      .where(eq(trustedContacts.userId, secondUser.id));
    expect(secondUserContacts).toHaveLength(1);
    expect(secondUserContacts[0].phoneE164).toBe('+919833344455');

    const secondUserJourneys = await db
      .select()
      .from(journeys)
      .where(eq(journeys.userId, secondUser.id));
    expect(secondUserJourneys).toHaveLength(1);
    expect(secondUserJourneys[0].note).toBe('Second user walk note');

    const secondUserReports = await db
      .select()
      .from(reports)
      .where(eq(reports.userId, secondUser.id));
    expect(secondUserReports).toHaveLength(1);
    expect(secondUserReports[0].note).toBe('Second user report note');

    // Admin metrics still work and include the anonymized incident & rating without error
    const metricsRes = await adminAgent.get('/api/admin/metrics');
    expect(metricsRes.status).toBe(200);
    expect(metricsRes.body.metrics.post_incident_trust_score.n).toBeGreaterThanOrEqual(1);
  });

  it('3. DELETE /api/me is refused when the user has an open GENUINE incident or an open DURESS incident, returning the exact same 409 status and neutral message', async () => {
    const app = createApp();

    // Case A: User with an open GENUINE incident (e.g. ACTIVE)
    const { agent: genuineAgent } = await loginAs(app, '+919876500111');
    const genIncRes = await genuineAgent.post('/api/incidents').send({
      client_request_id: 'req_open_genuine_1',
    });
    expect(genIncRes.status).toBe(201);
    const genIncId = genIncRes.body.incident.id;
    await activateAndDispatchIncident(genIncId, db);

    const genOtpRes = await genuineAgent
      .post('/api/auth/otp/request')
      .send({ phone_e164: '+919876500111' });
    const genOtp = genOtpRes.body.dev_mock_hint || (defaultOtpProvider as any).lastOtpCode;

    const genDelRes = await genuineAgent.delete('/api/me').send({
      confirmation: 'DELETE',
      otp_code: genOtp,
    });

    // Case B: User with an open DURESS incident (cancelled with duress PIN so she sees CANCELLED, but responder side is still open)
    const { agent: duressAgent } = await loginAs(app, '+919876500333');
    await duressAgent.put('/api/settings/cancel-pin').send({ pin: '1234' });
    await duressAgent
      .put('/api/settings/duress-pin')
      .send({ pin: '9999', cancel_pin: '1234' });

    const durIncRes = await duressAgent.post('/api/incidents').send({
      client_request_id: 'req_open_duress_1',
    });
    expect(durIncRes.status).toBe(201);
    const durIncId = durIncRes.body.incident.id;

    // Cancel with duress PIN ('9999')
    const cancelRes = await duressAgent
      .post(`/api/incidents/${durIncId}/cancel`)
      .send({ pin: '9999' });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe('CANCELLED');

    const durOtpRes = await duressAgent
      .post('/api/auth/otp/request')
      .send({ phone_e164: '+919876500333' });
    const durOtp = durOtpRes.body.dev_mock_hint || (defaultOtpProvider as any).lastOtpCode;

    const durDelRes = await duressAgent.delete('/api/me').send({
      confirmation: 'DELETE',
      otp_code: durOtp,
    });

    // Both must be refused with the exact same HTTP status (409) and neutral message
    expect(genDelRes.status).toBe(409);
    expect(durDelRes.status).toBe(409);
    expect(genDelRes.status).toBe(durDelRes.status);
    expect(genDelRes.body.detail).toBe(
      "Account deletion isn't available right now. Try again later."
    );
    expect(durDelRes.body.detail).toBe(genDelRes.body.detail);
  });

  it('4. Retention purge job: purges expired location_samples, contact_incident_tokens (>7d past expiry), contact_invitations (>30d past expiry), journeys.note (>7d after ends_at), expired otp_codes, and sent_messages (>7d)', async () => {
    const nowMs = Date.parse('2026-10-06T12:00:00.000Z');

    // 1. location_samples: 1 expired, 1 active
    await db.insert(locationSamples).values([
      {
        id: 'loc_exp',
        incidentId: 'inc_r_1',
        lat: 28.61,
        lng: 77.2,
        accuracyM: 10,
        capturedAt: '2026-09-20T10:00:00.000Z',
        expiresAt: nowMs - 1000,
      },
      {
        id: 'loc_fresh',
        incidentId: 'inc_r_1',
        lat: 28.61,
        lng: 77.2,
        accuracyM: 10,
        capturedAt: '2026-10-06T10:00:00.000Z',
        expiresAt: nowMs + 60_000,
      },
    ]);

    // 2. contact_incident_tokens: 1 expired > 7d ago, 1 expired 2d ago (kept until 7d), 1 active
    await db.insert(contactIncidentTokens).values([
      {
        id: 'cit_old',
        incidentId: 'inc_r_1',
        contactId: 'c_1',
        tokenHash: 'hash_cit_old',
        expiresAt: nowMs - SEVEN_DAYS_MS - 5000,
        createdAt: '2026-09-20T10:00:00.000Z',
      },
      {
        id: 'cit_recent',
        incidentId: 'inc_r_2',
        contactId: 'c_1',
        tokenHash: 'hash_cit_recent',
        expiresAt: nowMs - 2 * 24 * 60 * 60 * 1000,
        createdAt: '2026-10-03T10:00:00.000Z',
      },
    ]);

    // 3. contact_invitations: 1 expired > 30d ago, 1 expired 5d ago
    await db.insert(contactInvitations).values([
      {
        id: 'inv_old',
        contactId: 'c_1',
        tokenHash: 'hash_inv_old',
        expiresAt: nowMs - THIRTY_DAYS_MS - 5000,
        acceptedAt: null,
        createdAt: '2026-08-01T10:00:00.000Z',
      },
      {
        id: 'inv_recent',
        contactId: 'c_2',
        tokenHash: 'hash_inv_recent',
        expiresAt: nowMs - 5 * 24 * 60 * 60 * 1000,
        acceptedAt: null,
        createdAt: '2026-09-25T10:00:00.000Z',
      },
    ]);

    // 4. journeys.note: 1 ended > 7d ago with note, 1 ended 1d ago with note
    await db.insert(journeys).values([
      {
        id: 'j_old',
        userId: 'u_test',
        contactId: null,
        note: 'Old walk note that should be cleared',
        startedAt: new Date(nowMs - SEVEN_DAYS_MS - 3600_000).toISOString(),
        endsAt: new Date(nowMs - SEVEN_DAYS_MS - 1000).toISOString(),
        status: 'completed',
        reminderSentAt: null,
        lapsedNotifiedAt: null,
      },
      {
        id: 'j_recent',
        userId: 'u_test',
        contactId: null,
        note: 'Recent walk note that stays',
        startedAt: new Date(nowMs - 86400_000).toISOString(),
        endsAt: new Date(nowMs - 80000_000).toISOString(),
        status: 'completed',
        reminderSentAt: null,
        lapsedNotifiedAt: null,
      },
    ]);

    // 5. otp_codes: 1 expired, 1 active
    await db.insert(otpCodes).values([
      {
        id: 'otp_exp',
        phoneE164: '+919999900001',
        codeHash: 'hash1',
        expiresAt: nowMs - 500,
        attempts: 0,
        createdAt: '2026-10-06T11:00:00.000Z',
      },
      {
        id: 'otp_active',
        phoneE164: '+919999900002',
        codeHash: 'hash2',
        expiresAt: nowMs + 60_000,
        attempts: 0,
        createdAt: '2026-10-06T11:59:00.000Z',
      },
    ]);

    // 6. sent_messages: 1 older than 7d, 1 from today
    await db.insert(sentMessages).values([
      {
        id: 'msg_old',
        toPhoneE164: '+919999900001',
        body: 'Old dev SMS',
        provider: 'MockSmsProvider',
        purpose: 'otp',
        metadata: {},
        createdAt: new Date(nowMs - SEVEN_DAYS_MS - 10_000).toISOString(),
      },
      {
        id: 'msg_recent',
        toPhoneE164: '+919999900002',
        body: 'Recent dev SMS',
        provider: 'MockSmsProvider',
        purpose: 'otp',
        metadata: {},
        createdAt: new Date(nowMs - 60_000).toISOString(),
      },
    ]);

    const summary = await runLocationRetentionPurge(db, nowMs);
    expect(summary.deletedLocationSamples).toBe(1);
    expect(summary.deletedContactIncidentTokens).toBe(1);
    expect(summary.deletedContactInvitations).toBe(1);
    expect(summary.clearedJourneyNotes).toBe(1);
    expect(summary.deletedOtpCodes).toBe(1);
    expect(summary.deletedSentMessages).toBe(1);

    // Verify DB state after purge
    const [jOld] = await db
      .select()
      .from(journeys)
      .where(eq(journeys.id, 'j_old'));
    expect(jOld.note).toBeNull(); // Journey row kept, note cleared

    const [jRecent] = await db
      .select()
      .from(journeys)
      .where(eq(journeys.id, 'j_recent'));
    expect(jRecent.note).toBe('Recent walk note that stays');

    const remainingTokens = await db.select().from(contactIncidentTokens);
    expect(remainingTokens.map((t) => t.id)).toEqual(['cit_recent']);

    const remainingInvites = await db.select().from(contactInvitations);
    expect(remainingInvites.map((i) => i.id)).toEqual(['inv_recent']);

    const remainingOtps = await db.select().from(otpCodes);
    expect(remainingOtps.map((o) => o.id)).toEqual(['otp_active']);

    const remainingMsgs = await db.select().from(sentMessages);
    expect(remainingMsgs.map((m) => m.id)).toEqual(['msg_recent']);
  });
});
