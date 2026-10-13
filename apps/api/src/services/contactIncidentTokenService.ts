import crypto from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { config } from '../core/config';
import { getDb, type AppDatabase } from '../core/db';
import {
  createSignedContactIncidentToken,
  logger,
  parseAndHashContactIncidentToken,
  verifyContactIncidentTokenSignature,
} from '../core/security';
import {
  contactIncidentTokens,
  incidentEvents,
  incidents,
  locationSamples,
  OPEN_INCIDENT_STATUSES,
  TERMINAL_INCIDENT_STATUSES,
  trustedContacts,
  users,
  type IncidentStatus,
} from '../db/schema';
import { HttpError } from './authService';
import { recordIncidentAccessAudit } from './auditService';
import { getNotifiableContacts } from './contactService';
import { getHydratedIncident } from './incidentService';
import { transition } from './incidentStateMachine';
import { cancelScheduledEscalation } from './scheduler';
import { broadcastIncidentUpdate } from './wsHub';

export const CONTACT_RESPONSE_ACTIONS = [
  'seen',
  'calling_her',
  'on_my_way',
  'cannot_help',
  'confirm_safe',
] as const;

export type ContactResponseAction = (typeof CONTACT_RESPONSE_ACTIONS)[number];

export interface ContactIncidentViewDto {
  incident_id: string;
  user_first_name: string;
  user_phone_e164: string;
  contact_id: string;
  contact_name: string;
  triggered_at: string;
  activated_at: string | null;
  emergency_type: string | null;
  status: IncidentStatus;
  is_duress: boolean;
  duress_notice: string | null;
  can_see_live_location: boolean;
  location_freshness_seconds: number | null;
  location?: {
    lat: number;
    lng: number;
    accuracy_m: number | null;
    captured_at: string;
  };
}

export const DURESS_SAFETY_NOTICE_EN =
  'Her phone shows this alert as cancelled. She may not be able to talk safely. Do not call or message her. Consider contacting security or 112.';

function extractFirstName(fullName: string): string {
  const trimmed = (fullName || '').trim();
  if (!trimmed) return 'SAATHI User';
  return trimmed.split(/\s+/)[0];
}

/**
 * Issues a signed, expiring magic-link token scoped to ONE contact + ONE incident.
 * Stores ONLY the SHA-256 token_hash in `contact_incident_tokens`.
 * Never logs the raw token.
 */
export async function issueContactIncidentMagicToken(
  db: AppDatabase,
  incidentId: string,
  contactId: string,
  ttlMs?: number
): Promise<{
  token: string;
  urlPath: string;
  expiresAt: number;
}> {
  const { token, tokenHash } = createSignedContactIncidentToken(
    incidentId,
    contactId
  );
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const defaultTtlMs =
    ttlMs ?? Math.max(config.incidentAutoExpireMinutes * 60 * 1000, 3600_000);
  const expiresAt = nowMs + defaultTtlMs;

  const [existing] = await db
    .select()
    .from(contactIncidentTokens)
    .where(
      and(
        eq(contactIncidentTokens.incidentId, incidentId),
        eq(contactIncidentTokens.contactId, contactId)
      )
    )
    .limit(1);

  if (existing) {
    await db
      .update(contactIncidentTokens)
      .set({
        tokenHash,
        expiresAt,
        createdAt: nowIso,
      })
      .where(eq(contactIncidentTokens.id, existing.id));
  } else {
    await db.insert(contactIncidentTokens).values({
      id: crypto.randomUUID(),
      incidentId,
      contactId,
      tokenHash,
      expiresAt,
      createdAt: nowIso,
    });
  }

  return {
    token,
    urlPath: `/c/${token}`,
    expiresAt,
  };
}

async function resolveAndAuthorizeMagicToken(
  db: AppDatabase,
  rawToken: string
) {
  const tokenHash = parseAndHashContactIncidentToken(rawToken);
  if (!tokenHash) {
    throw new HttpError(404, 'Invalid or tampered emergency link.');
  }

  const [tokenRow] = await db
    .select()
    .from(contactIncidentTokens)
    .where(eq(contactIncidentTokens.tokenHash, tokenHash))
    .limit(1);

  if (!tokenRow) {
    throw new HttpError(404, 'Emergency link not found.');
  }

  // Verify cryptographic signature binds this exact incidentId and contactId
  if (
    !verifyContactIncidentTokenSignature(
      rawToken,
      tokenRow.incidentId,
      tokenRow.contactId
    )
  ) {
    throw new HttpError(404, 'Invalid emergency link signature.');
  }

  const [inc] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, tokenRow.incidentId))
    .limit(1);

  if (!inc) {
    throw new HttpError(404, 'Incident not found.');
  }

  // Token stops working when the incident closes (RESOLVED, CANCELLED, EXPIRED, FALSE_ALARM)
  if (TERMINAL_INCIDENT_STATUSES.includes(inc.status)) {
    throw new HttpError(
      410,
      `This emergency alert is closed (${inc.status}). The link is no longer active.`
    );
  }

  // Check token time expiry
  if (Date.now() > tokenRow.expiresAt) {
    throw new HttpError(410, 'This emergency link has expired.');
  }

  // Re-evaluate getNotifiableContacts at the time of EACH request:
  // If the contact was paused/removed, receives_sos was turned off, or data_processing consent was revoked since, stop immediately.
  const eligibleSosContacts = await getNotifiableContacts(
    inc.userId,
    'sos',
    db
  );
  const authorizedContact = eligibleSosContacts.find(
    (c) => c.id === tokenRow.contactId
  );

  if (!authorizedContact) {
    throw new HttpError(
      403,
      'Access to this alert is no longer active because contact permissions or user consent changed.'
    );
  }

  const [contactRow] = await db
    .select()
    .from(trustedContacts)
    .where(eq(trustedContacts.id, tokenRow.contactId))
    .limit(1);

  if (!contactRow || contactRow.userId !== inc.userId) {
    throw new HttpError(403, 'Unauthorized contact for this incident.');
  }

  const [owner] = await db
    .select()
    .from(users)
    .where(eq(users.id, inc.userId))
    .limit(1);

  if (!owner) {
    throw new HttpError(404, 'Incident owner not found.');
  }

  return {
    tokenRow,
    incident: inc,
    contact: authorizedContact,
    owner,
  };
}

export async function getContactIncidentSummaryByToken(
  db: AppDatabase,
  rawToken: string,
  options?: { skipAudit?: boolean }
): Promise<ContactIncidentViewDto> {
  const { incident, contact, owner } = await resolveAndAuthorizeMagicToken(
    db,
    rawToken
  );

  if (!options?.skipAudit) {
    await recordIncidentAccessAudit(db, {
      incidentId: incident.id,
      actorType: 'contact',
      actorId: contact.id,
      actorLabel: contact.name,
      action: 'contact_link_open',
      detail: `Trusted contact ${contact.name} viewed emergency link`,
    });
  }

  // Include location ONLY if that contact has can_see_live_location AND the user's location consent is active
  const liveLocationEligible = await getNotifiableContacts(
    incident.userId,
    'live_location',
    db
  );
  const canSeeLocation = liveLocationEligible.some((c) => c.id === contact.id);

  let latestPoint:
    | {
        lat: number;
        lng: number;
        accuracy_m: number | null;
        captured_at: string;
      }
    | undefined;
  let freshnessSeconds: number | null = null;

  if (canSeeLocation) {
    const [sample] = await db
      .select()
      .from(locationSamples)
      .where(eq(locationSamples.incidentId, incident.id))
      .orderBy(desc(locationSamples.capturedAt))
      .limit(1);

    if (sample) {
      latestPoint = {
        lat: sample.lat,
        lng: sample.lng,
        accuracy_m: sample.accuracyM ?? null,
        captured_at: sample.capturedAt,
      };
      const capturedMs = new Date(sample.capturedAt).getTime();
      freshnessSeconds = Math.max(0, Math.round((Date.now() - capturedMs) / 1000));
    }
  }

  const isDuress = Boolean(incident.isDuress);

  const result: ContactIncidentViewDto = {
    incident_id: incident.id,
    user_first_name: extractFirstName(owner.name),
    user_phone_e164: owner.phoneE164,
    contact_id: contact.id,
    contact_name: contact.name,
    triggered_at: incident.createdAt,
    activated_at: incident.activatedAt ?? null,
    emergency_type: incident.emergencyType ?? null,
    status: incident.status,
    is_duress: isDuress,
    duress_notice: isDuress ? DURESS_SAFETY_NOTICE_EN : null,
    can_see_live_location: canSeeLocation,
    location_freshness_seconds: freshnessSeconds,
    ...(canSeeLocation && latestPoint ? { location: latestPoint } : {}),
  };

  return result;
}

export async function recordContactResponseByToken(
  db: AppDatabase,
  rawToken: string,
  action: ContactResponseAction,
  note?: string,
  options?: {
    simulationMarker?: string;
  }
): Promise<{
  action: ContactResponseAction;
  incident_status: IncidentStatus;
  closed: boolean;
  summary: ContactIncidentViewDto | null;
}> {
  const { incident, contact } = await resolveAndAuthorizeMagicToken(
    db,
    rawToken
  );

  if (incident.isDuress && action === 'calling_her') {
    throw new HttpError(
      400,
      'Do not call her during a duress alert. Her phone shows this alert as cancelled.'
    );
  }

  const simPrefix = options?.simulationMarker
    ? `[simulated] (${options.simulationMarker}) `
    : '';
  const effectiveNote = note
    ? `${simPrefix}${note}`
    : options?.simulationMarker
    ? `${simPrefix}Trusted contact ${contact.name} submitted action ${action}`
    : undefined;

  await recordIncidentAccessAudit(db, {
    incidentId: incident.id,
    actorType: 'contact',
    actorId: contact.id,
    actorLabel: options?.simulationMarker
      ? `${contact.name} (simulated)`
      : contact.name,
    action: options?.simulationMarker
      ? `simulated:contact_action:${action}`
      : `contact_action:${action}`,
    detail:
      effectiveNote ||
      `Trusted contact ${contact.name} submitted action ${action}`,
  });

  const nowIso = new Date().toISOString();
  let nextStatus: IncidentStatus = incident.status;

  if (action === 'confirm_safe') {
    // confirm_safe closes (RESOLVED) the real incident, including a duress incident
    cancelScheduledEscalation(incident.id);
    const { incident: updated } = await transition(
      incident.id,
      'RESOLVED',
      { type: 'contact', id: contact.id },
      effectiveNote ||
        `Trusted contact ${contact.name} confirmed she is safe (confirm_safe)`,
      db
    );
    nextStatus = updated.status;

    const realHydrated = await getHydratedIncident(
      db,
      incident.id,
      undefined,
      { viewerRole: 'system' }
    );
    broadcastIncidentUpdate(realHydrated);

    return {
      action,
      incident_status: nextStatus,
      closed: true,
      summary: null,
    };
  }

  if (action === 'seen') {
    // Acknowledgement stops the escalation ladder
    cancelScheduledEscalation(incident.id);

    if (incident.status === 'ACTIVE' || incident.status === 'NOTIFIED') {
      const { incident: updated } = await transition(
        incident.id,
        'ACKNOWLEDGED',
        { type: 'contact', id: contact.id },
        effectiveNote ||
          `Trusted contact ${contact.name} acknowledged alert (seen)`,
        db
      );
      nextStatus = updated.status;
    } else {
      await db.insert(incidentEvents).values({
        id: crypto.randomUUID(),
        incidentId: incident.id,
        fromStatus: incident.status,
        toStatus: incident.status,
        actorType: 'contact',
        actorId: contact.id,
        note:
          effectiveNote ||
          `Trusted contact ${contact.name} acknowledged alert (seen)`,
        createdAt: nowIso,
      });
    }
  } else if (action === 'on_my_way' || action === 'calling_her') {
    // Responding also stops the escalation ladder
    cancelScheduledEscalation(incident.id);

    if (
      incident.status === 'ACTIVE' ||
      incident.status === 'NOTIFIED' ||
      incident.status === 'ACKNOWLEDGED'
    ) {
      const { incident: updated } = await transition(
        incident.id,
        'RESPONDING',
        { type: 'contact', id: contact.id },
        effectiveNote ||
          `Trusted contact ${contact.name} responded with ${action}`,
        db
      );
      nextStatus = updated.status;
    } else {
      await db.insert(incidentEvents).values({
        id: crypto.randomUUID(),
        incidentId: incident.id,
        fromStatus: incident.status,
        toStatus: incident.status,
        actorType: 'contact',
        actorId: contact.id,
        note:
          effectiveNote ||
          `Trusted contact ${contact.name} responded with ${action}`,
        createdAt: nowIso,
      });
    }
  } else if (action === 'cannot_help') {
    await db.insert(incidentEvents).values({
      id: crypto.randomUUID(),
      incidentId: incident.id,
      fromStatus: incident.status,
      toStatus: incident.status,
      actorType: 'contact',
      actorId: contact.id,
      note:
        effectiveNote ||
        `Trusted contact ${contact.name} indicated cannot_help right now`,
      createdAt: nowIso,
    });
  }

  logger.info(
    `Trusted contact response recorded (incident=${incident.id}, action=${action}, status=${nextStatus})`
  );

  const realHydrated = await getHydratedIncident(db, incident.id, undefined, {
    viewerRole: 'system',
  });
  // Pushes to owner's WebSocket while respecting duress masking (owner of a duress incident sees nothing about contact activity)
  broadcastIncidentUpdate(realHydrated);

  const summary = OPEN_INCIDENT_STATUSES.includes(nextStatus)
    ? await getContactIncidentSummaryByToken(db, rawToken, { skipAudit: true })
    : null;

  return {
    action,
    incident_status: nextStatus,
    closed: false,
    summary,
  };
}
