import crypto from 'crypto';
import { asc, desc, eq, inArray, notInArray } from 'drizzle-orm';
import { getDb, type AppDatabase } from '../core/db';
import { verifyOtpCodeHash, logger } from '../core/security';
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
  reports,
  responders,
  safetyPulses,
  sentMessages,
  trustedContacts,
  users,
  type UserRow,
} from '../db/schema';
import { HttpError, toUserResponseDto } from './authService';
import { getConsentsForUser } from './consentService';
import { toTrustedContactDto } from './contactService';
import { getHydratedIncident } from './incidentService';
import { cancelScheduledActivation, cancelScheduledJourneyTimers } from './scheduler';

export interface UserDataExportDto {
  exported_at: string;
  profile: ReturnType<typeof toUserResponseDto>;
  consent_ledger: Awaited<ReturnType<typeof getConsentsForUser>>;
  trusted_contacts: Array<{
    id: string;
    name: string;
    phone_e164: string;
    priority_order: number;
    permissions: {
      receives_sos: boolean;
      receives_checkin: boolean;
      can_see_live_location: boolean;
    };
    status: string;
    created_at: string;
    updated_at: string;
  }>;
  incidents: Array<{
    id: string;
    status: string;
    emergency_type: string | null;
    source_trigger: string;
    created_at: string;
    activated_at: string | null;
    closed_at: string | null;
    events: Array<{
      id: string;
      from_status: string | null;
      to_status: string;
      actor_type: string;
      note: string | null;
      created_at: string;
    }>;
    locations: Array<{
      id: string;
      lat: number;
      lng: number;
      accuracy_m: number | null;
      captured_at: string;
      expires_at: number | string;
    }>;
  }>;
  journeys: Array<{
    id: string;
    contact_id: string | null;
    note: string | null;
    started_at: string;
    ends_at: string;
    status: string;
    reminder_sent_at: string | null;
    lapsed_notified_at: string | null;
  }>;
  reports: Array<{
    id: string;
    category: string;
    lat: number;
    lng: number;
    note: string | null;
    anonymous: false;
    created_at: string;
  }>;
  safety_pulses: Array<{
    id: string;
    safety_score: number;
    avoided_going_somewhere: boolean;
    anonymous: false;
    created_at: string;
  }>;
}

/**
 * Task 2: GET /api/me/export
 * Returns a JSON download of ONLY the signed-in user's data:
 * - profile
 * - consent ledger
 * - contacts she added (name, phone, status as she entered them)
 * - her incidents and events AS SHE SEES THEM (duress masking applies: a duress incident appears cancelled)
 * - journeys
 * - her own non-anonymous reports and pulses (anonymous ones have no user_id, so they are not in the export)
 * Never includes PIN hashes, tokens, or responder notes.
 */
export async function exportUserData(
  dbInstance: AppDatabase | undefined,
  user: UserRow
): Promise<UserDataExportDto> {
  const db = dbInstance || getDb();

  const profile = toUserResponseDto(user);
  const consentLedger = await getConsentsForUser(db, user.id);

  // All contacts she added (as she entered them)
  const contactRows = await db
    .select()
    .from(trustedContacts)
    .where(eq(trustedContacts.userId, user.id))
    .orderBy(asc(trustedContacts.priorityOrder), asc(trustedContacts.createdAt));

  const contactsExport = contactRows.map((row) => {
    const dto = toTrustedContactDto(row);
    return {
      id: dto.id,
      name: dto.name,
      phone_e164: dto.phone_e164,
      priority_order: dto.priority_order,
      permissions: dto.permissions,
      status: dto.status,
      created_at: dto.created_at,
      updated_at: dto.updated_at,
    };
  });

  // Her incidents and events AS SHE SEES THEM (viewerRole: 'owner' applies duress masking)
  const userIncidentRows = await db
    .select()
    .from(incidents)
    .where(eq(incidents.userId, user.id))
    .orderBy(desc(incidents.createdAt));

  const exportedIncidents: UserDataExportDto['incidents'] = [];
  for (const incRow of userIncidentRows) {
    const ownerHydrated = await getHydratedIncident(db, incRow.id, user.id, {
      viewerRole: 'owner',
    });

    // Exclude responder notes and non-user actor notes so export never leaks responder notes or contact details
    const ownerEvents = (ownerHydrated.events || [])
      .filter((ev) => ev.actor_type !== 'responder')
      .map((ev) => ({
        id: ev.id,
        from_status: ev.from_status,
        to_status: ev.to_status,
        actor_type: ev.actor_type,
        note: ev.actor_type === 'user' ? ev.note : null,
        created_at: ev.created_at,
      }));

    const ownerLocations = (ownerHydrated.locations || []).map((loc) => ({
      id: loc.id,
      lat: loc.lat,
      lng: loc.lng,
      accuracy_m: loc.accuracy_m,
      captured_at: loc.captured_at,
      expires_at: loc.expires_at,
    }));

    exportedIncidents.push({
      id: ownerHydrated.id,
      status: ownerHydrated.status,
      emergency_type: ownerHydrated.emergency_type,
      source_trigger: ownerHydrated.source_trigger,
      created_at: ownerHydrated.created_at,
      activated_at: ownerHydrated.activated_at,
      closed_at: ownerHydrated.closed_at,
      events: ownerEvents,
      locations: ownerLocations,
    });
  }

  // Her journeys
  const journeyRows = await db
    .select()
    .from(journeys)
    .where(eq(journeys.userId, user.id))
    .orderBy(desc(journeys.startedAt));

  const exportedJourneys = journeyRows.map((j) => ({
    id: j.id,
    contact_id: j.contactId ?? null,
    note: j.note ?? null,
    started_at: j.startedAt,
    ends_at: j.endsAt,
    status: j.status,
    reminder_sent_at: j.reminderSentAt ?? null,
    lapsed_notified_at: j.lapsedNotifiedAt ?? null,
  }));

  // Her own non-anonymous reports (anonymous reports have user_id = NULL)
  const reportRows = await db
    .select()
    .from(reports)
    .where(eq(reports.userId, user.id))
    .orderBy(desc(reports.createdAt));

  const exportedReports = reportRows
    .filter((r) => !r.anonymous && r.userId === user.id)
    .map((r) => ({
      id: r.id,
      category: r.category,
      lat: r.lat,
      lng: r.lng,
      note: r.note ?? null,
      anonymous: false as const,
      created_at: r.createdAt,
    }));

  // Her own non-anonymous safety pulses (anonymous pulses have user_id = NULL)
  const pulseRows = await db
    .select()
    .from(safetyPulses)
    .where(eq(safetyPulses.userId, user.id))
    .orderBy(desc(safetyPulses.createdAt));

  const exportedPulses = pulseRows
    .filter((p) => p.userId === user.id)
    .map((p) => ({
      id: p.id,
      safety_score: p.safetyScore,
      avoided_going_somewhere: Boolean(p.avoidedGoingSomewhere),
      anonymous: false as const,
      created_at: p.createdAt,
    }));

  return {
    exported_at: new Date().toISOString(),
    profile,
    consent_ledger: consentLedger,
    trusted_contacts: contactsExport,
    incidents: exportedIncidents,
    journeys: exportedJourneys,
    reports: exportedReports,
    safety_pulses: exportedPulses,
  };
}

export const ACCOUNT_DELETION_UNAVAILABLE_MESSAGE =
  "Account deletion isn't available right now. Try again later.";

/**
 * Task 3: DELETE /api/me
 * Requires recent re-authentication via a fresh OTP ONLY AND a confirmation string ("DELETE").
 * Refuses deletion if the user has any open incident (whether genuine or duress) with the
 * exact same neutral message and 409 status code so an attacker under duress cannot tell the difference.
 * Runs inside a single database transaction so a partial failure leaves no half-deleted state.
 * Clears auth cookies on completion.
 */
export async function deleteUserAccount(
  dbInstance: AppDatabase | undefined,
  user: UserRow,
  input: {
    confirmation: string;
    otp_code?: string;
    cancel_pin?: string;
  }
): Promise<{ status: 'account_deleted' }> {
  const db = dbInstance || getDb();

  if (input.confirmation !== 'DELETE') {
    throw new HttpError(
      400,
      'You must type "DELETE" to confirm account deletion.'
    );
  }

  // Reject Cancel PIN — deletion requires a fresh OTP ONLY
  if (input.cancel_pin !== undefined && input.cancel_pin !== '') {
    throw new HttpError(
      400,
      'Account deletion requires a fresh 6-digit OTP code. Cancel PIN is not accepted.'
    );
  }

  const otpCode = input.otp_code?.trim();
  if (!otpCode) {
    throw new HttpError(
      401,
      'A fresh 6-digit OTP code is required to delete your account.'
    );
  }

  const [otpRecord] = await db
    .select()
    .from(otpCodes)
    .where(eq(otpCodes.phoneE164, user.phoneE164))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);

  if (!otpRecord || Date.now() > otpRecord.expiresAt) {
    throw new HttpError(
      401,
      'Invalid or expired OTP code for account deletion.'
    );
  }

  const otpValid = verifyOtpCodeHash(
    user.phoneE164,
    otpCode,
    otpRecord.codeHash
  );
  if (!otpValid) {
    throw new HttpError(401, 'Invalid OTP code for account deletion.');
  }

  // Gather incidents for this user and refuse deletion if any incident is open
  // (Genuine open statuses: TRIGGERED, CREATED, CANCEL_WINDOW, ACTIVE, ESCALATED, ACKNOWLEDGED;
  //  Duress open: any incident not yet RESOLVED or FALSE_ALARM — including TRIGGERED/ACTIVE/ACKNOWLEDGED/CANCELLED with isDuress === true)
  const userIncidents = await db
    .select()
    .from(incidents)
    .where(eq(incidents.userId, user.id));

  const hasOpenIncident = userIncidents.some((inc) => {
    const s = inc.status as string;
    if (
      s === 'TRIGGERED' ||
      s === 'CREATED' ||
      s === 'CANCEL_WINDOW' ||
      s === 'ACTIVE' ||
      s === 'ESCALATED' ||
      s === 'ACKNOWLEDGED'
    ) {
      return true;
    }
    if (inc.isDuress && inc.status !== 'RESOLVED' && inc.status !== 'FALSE_ALARM') {
      return true;
    }
    return false;
  });

  if (hasOpenIncident) {
    throw new HttpError(409, ACCOUNT_DELETION_UNAVAILABLE_MESSAGE);
  }

  const incidentIds = userIncidents.map((inc) => inc.id);

  const userContacts = await db
    .select()
    .from(trustedContacts)
    .where(eq(trustedContacts.userId, user.id));
  const contactIds = userContacts.map((c) => c.id);
  const contactPhones = userContacts.map((c) => c.phoneE164);
  const contactNames = userContacts.map((c) => c.name);

  const userJourneys = await db
    .select()
    .from(journeys)
    .where(eq(journeys.userId, user.id));
  const journeyIds = userJourneys.map((j) => j.id);

  // Stop any scheduled timers for this user's incidents and journeys
  for (const incId of incidentIds) {
    cancelScheduledActivation(incId);
  }
  for (const jId of journeyIds) {
    cancelScheduledJourneyTimers(jId);
  }

  // Execute all deletions and anonymizations inside a SINGLE database transaction
  await db.transaction(async (tx) => {
    // 1. Delete OTP codes for the user's phone
    await tx.delete(otpCodes).where(eq(otpCodes.phoneE164, user.phoneE164));

    // 2. Delete consent ledger entries
    await tx.delete(consents).where(eq(consents.userId, user.id));

    // 3. Delete contact invitations & contact incident tokens
    if (contactIds.length > 0) {
      await tx
        .delete(contactInvitations)
        .where(inArray(contactInvitations.contactId, contactIds));
      await tx
        .delete(contactIncidentTokens)
        .where(inArray(contactIncidentTokens.contactId, contactIds));
    }
    if (incidentIds.length > 0) {
      await tx
        .delete(contactIncidentTokens)
        .where(inArray(contactIncidentTokens.incidentId, incidentIds));
    }

    // 4. Delete trusted contacts
    await tx.delete(trustedContacts).where(eq(trustedContacts.userId, user.id));

    // 5. Delete location samples for the user's incidents
    if (incidentIds.length > 0) {
      await tx
        .delete(locationSamples)
        .where(inArray(locationSamples.incidentId, incidentIds));
    }

    // 6. Delete journeys
    await tx.delete(journeys).where(eq(journeys.userId, user.id));

    // 7. Scrub dev outbox (sent_messages) rows linked to the user, her contacts, her incidents, or her journeys
    const allOutbox = await tx.select().from(sentMessages);
    const outboxIdsToDelete: string[] = [];
    const phoneSet = new Set([user.phoneE164, ...contactPhones]);
    const nameSet = new Set([user.name, ...contactNames].filter(Boolean));
    const incIdSet = new Set(incidentIds);
    const contactIdSet = new Set(contactIds);
    const journeyIdSet = new Set(journeyIds);

    for (const msg of allOutbox) {
      const meta = (msg.metadata || {}) as Record<string, unknown>;
      const metaStr = JSON.stringify(meta);
      const metaIncId =
        typeof meta.incident_id === 'string' ? meta.incident_id : '';
      const metaContactId =
        typeof meta.contact_id === 'string'
          ? meta.contact_id
          : typeof meta.contactId === 'string'
            ? meta.contactId
            : '';
      const metaJourneyId =
        typeof meta.journeyId === 'string' ? meta.journeyId : '';
      const metaInviterName =
        typeof meta.inviter_name === 'string' ? meta.inviter_name : '';

      const mentionsPhoneOrName =
        Array.from(phoneSet).some(
          (ph) => msg.body.includes(ph) || metaStr.includes(ph)
        ) ||
        Array.from(nameSet).some(
          (nm) => nm && (msg.body.includes(nm) || metaStr.includes(nm))
        );

      if (
        phoneSet.has(msg.toPhoneE164) ||
        (metaIncId && incIdSet.has(metaIncId)) ||
        (metaContactId && contactIdSet.has(metaContactId)) ||
        (metaJourneyId && journeyIdSet.has(metaJourneyId)) ||
        metaInviterName === user.name ||
        mentionsPhoneOrName
      ) {
        outboxIdsToDelete.push(msg.id);
      }
    }

    if (outboxIdsToDelete.length > 0) {
      await tx
        .delete(sentMessages)
        .where(inArray(sentMessages.id, outboxIdsToDelete));
    }

    // 8. Anonymize incidents, incident_events, notifications, and incident_access_audit
    // so aggregated metrics and audit completeness remain intact without any personal data
    if (incidentIds.length > 0) {
      for (const inc of userIncidents) {
        await tx
          .update(incidents)
          .set({
            userId: 'deleted_user',
            clientRequestId: `anon_${crypto.randomUUID()}`,
          })
          .where(eq(incidents.id, inc.id));
      }

      await tx
        .update(incidentEvents)
        .set({
          actorId: null,
          note: null,
        })
        .where(inArray(incidentEvents.incidentId, incidentIds));

      await tx
        .update(notifications)
        .set({
          recipientRef: 'redacted',
          lastError: null,
        })
        .where(inArray(notifications.incidentId, incidentIds));

      await tx
        .update(incidentAccessAudit)
        .set({
          actorId: 'redacted',
          actorLabel: null,
          detail: null,
        })
        .where(inArray(incidentAccessAudit.incidentId, incidentIds));
    }

    // Also scrub any incident_events or audit rows where this user was the actor or where her/her contacts' PII appears
    await tx
      .update(incidentEvents)
      .set({
        actorId: null,
        note: null,
      })
      .where(eq(incidentEvents.actorId, user.id));

    await tx
      .update(incidentAccessAudit)
      .set({
        actorId: 'redacted',
        actorLabel: null,
        detail: null,
      })
      .where(eq(incidentAccessAudit.actorId, user.id));

    const allAuditRows = await tx.select().from(incidentAccessAudit);
    for (const aud of allAuditRows) {
      const text = `${aud.actorId ?? ''} ${aud.actorLabel ?? ''} ${aud.detail ?? ''}`;
      const hasPii =
        Array.from(phoneSet).some((ph) => text.includes(ph)) ||
        Array.from(nameSet).some((nm) => nm && text.includes(nm)) ||
        contactIdSet.has(aud.actorId);
      if (hasPii) {
        await tx
          .update(incidentAccessAudit)
          .set({
            actorId: 'redacted',
            actorLabel: null,
            detail: null,
          })
          .where(eq(incidentAccessAudit.id, aud.id));
      }
    }

    const allEventRows = await tx.select().from(incidentEvents);
    for (const ev of allEventRows) {
      const text = `${ev.actorId ?? ''} ${ev.note ?? ''}`;
      const hasPii =
        Array.from(phoneSet).some((ph) => text.includes(ph)) ||
        Array.from(nameSet).some((nm) => nm && text.includes(nm)) ||
        (ev.actorId ? contactIdSet.has(ev.actorId) : false);
      if (hasPii) {
        await tx
          .update(incidentEvents)
          .set({
            actorId: null,
            note: null,
          })
          .where(eq(incidentEvents.id, ev.id));
      }
    }

    const allNotifRows = await tx.select().from(notifications);
    for (const nf of allNotifRows) {
      const text = `${nf.recipientRef ?? ''} ${nf.lastError ?? ''}`;
      const hasPii =
        Array.from(phoneSet).some((ph) => text.includes(ph)) ||
        Array.from(nameSet).some((nm) => nm && text.includes(nm)) ||
        contactIdSet.has(nf.recipientRef);
      if (hasPii) {
        await tx
          .update(notifications)
          .set({
            recipientRef: 'redacted',
            lastError: null,
          })
          .where(eq(notifications.id, nf.id));
      }
    }

    // 9. Anonymize any non-anonymous safety reports submitted by this user
    const userReports = await tx
      .select()
      .from(reports)
      .where(eq(reports.userId, user.id));
    for (const rep of userReports) {
      await tx
        .update(reports)
        .set({
          userId: null,
          anonymous: true,
          note: null,
          createdAt: rep.createdAt.slice(0, 10),
        })
        .where(eq(reports.id, rep.id));
    }

    // 10. Anonymize any non-anonymous safety pulses submitted by this user
    const userPulses = await tx
      .select()
      .from(safetyPulses)
      .where(eq(safetyPulses.userId, user.id));
    for (const p of userPulses) {
      await tx
        .update(safetyPulses)
        .set({
          userId: null,
          createdAt: p.createdAt.slice(0, 10),
        })
        .where(eq(safetyPulses.id, p.id));
    }

    // 11. If user had responder/assignment rows, anonymize or delete them
    await tx
      .update(incidentAssignments)
      .set({ responderUserId: 'deleted_user' })
      .where(eq(incidentAssignments.responderUserId, user.id));
    await tx
      .update(incidentAssignments)
      .set({ assignedByUserId: null })
      .where(eq(incidentAssignments.assignedByUserId, user.id));
    await tx.delete(responders).where(eq(responders.userId, user.id));

    // 12. Delete the user account row itself
    await tx.delete(users).where(eq(users.id, user.id));
  });

  logger.info(`[Privacy] User account deleted and personal data scrubbed`);

  return { status: 'account_deleted' };
}
