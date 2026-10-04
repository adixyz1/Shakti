import crypto from 'crypto';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { config } from '../core/config';
import { getDb, type AppDatabase } from '../core/db';
import {
  hashCancelPin,
  hashDuressPin,
  logger,
  verifyCancelPinHash,
  verifyDuressPinHash,
} from '../core/security';
import {
  consents,
  incidentEvents,
  incidents,
  locationSamples,
  notifications,
  OPEN_INCIDENT_STATUSES,
  users,
  type IncidentEventRow,
  type IncidentRow,
  type LocationSampleRow,
  type NotificationRow,
  type UserRow,
} from '../db/schema';
import type {
  IncidentDto,
  IncidentEventDto,
  LocationSampleDto,
  NotificationDto,
} from '../schemas/incident';
import { HttpError } from './authService';
import { getNotifiableContacts } from './contactService';
import { transition } from './incidentStateMachine';
import {
  cancelScheduledActivation,
  scheduleIncidentActivation,
  scheduleShadowMergedActivation,
} from './scheduler';
import { broadcastIncidentUpdate, maskIncidentForOwner } from './wsHub';

export function toIncidentEventDto(row: IncidentEventRow): IncidentEventDto {
  return {
    id: row.id,
    incident_id: row.incidentId,
    from_status: row.fromStatus ?? null,
    to_status: row.toStatus,
    actor_type: row.actorType,
    actor_id: row.actorId ?? null,
    note: row.note ?? null,
    created_at: row.createdAt,
  };
}

export function toLocationSampleDto(row: LocationSampleRow): LocationSampleDto {
  return {
    id: row.id,
    incident_id: row.incidentId,
    lat: row.lat,
    lng: row.lng,
    accuracy_m: row.accuracyM ?? null,
    captured_at: row.capturedAt,
    expires_at: row.expiresAt,
  };
}

export function toNotificationDto(row: NotificationRow): NotificationDto {
  return {
    id: row.id,
    incident_id: row.incidentId,
    recipient_type: row.recipientType,
    recipient_ref: row.recipientRef,
    channel: row.channel,
    status: row.status,
    attempts: row.attempts,
    last_error: row.lastError ?? null,
    created_at: row.createdAt,
  };
}

export function toIncidentDto(
  row: IncidentRow,
  events?: IncidentEventRow[],
  locations?: LocationSampleRow[],
  notifiableContactsCount?: number,
  notifs?: NotificationRow[]
): IncidentDto {
  return {
    id: row.id,
    user_id: row.userId,
    status: row.status,
    emergency_type: row.emergencyType ?? null,
    client_request_id: row.clientRequestId,
    created_at: row.createdAt,
    activated_at: row.activatedAt ?? null,
    closed_at: row.closedAt ?? null,
    merged_into_id: row.mergedIntoId ?? null,
    source_trigger: row.sourceTrigger,
    is_duress: Boolean(row.isDuress),
    needs_user_action: Boolean(row.needsUserAction),
    escalation_stage: row.escalationStage ?? 0,
    auto_expire_minutes: config.incidentAutoExpireMinutes,
    ...(notifiableContactsCount !== undefined
      ? { notifiable_contacts_count: notifiableContactsCount }
      : {}),
    ...(events ? { events: events.map(toIncidentEventDto) } : {}),
    ...(locations ? { locations: locations.map(toLocationSampleDto) } : {}),
    ...(notifs ? { notifications: notifs.map(toNotificationDto) } : {}),
  };
}

export async function getHydratedIncident(
  db: AppDatabase,
  incidentId: string,
  userId?: string,
  options?: { viewerRole?: 'owner' | 'responder' | 'contact' | 'system' }
): Promise<IncidentDto> {
  const [inc] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, incidentId))
    .limit(1);

  if (!inc || (userId && inc.userId !== userId)) {
    throw new HttpError(404, 'Incident not found.');
  }

  const events = await db
    .select()
    .from(incidentEvents)
    .where(eq(incidentEvents.incidentId, incidentId))
    .orderBy(asc(incidentEvents.createdAt));

  const locations = await db
    .select()
    .from(locationSamples)
    .where(eq(locationSamples.incidentId, incidentId))
    .orderBy(asc(locationSamples.capturedAt));

  const notifs = await db
    .select()
    .from(notifications)
    .where(eq(notifications.incidentId, incidentId))
    .orderBy(asc(notifications.createdAt));

  const eligibleSosContacts = await getNotifiableContacts(
    inc.userId,
    'sos',
    db
  );
  const dto = toIncidentDto(
    inc,
    events,
    locations,
    eligibleSosContacts.length,
    notifs
  );

  const viewerRole = options?.viewerRole ?? (userId ? 'owner' : 'system');
  if (viewerRole === 'owner') {
    return maskIncidentForOwner(dto);
  }
  return dto;
}

async function isLocationCaptureAllowed(
  db: AppDatabase,
  userId: string
): Promise<boolean> {
  const rows = await db
    .select()
    .from(consents)
    .where(and(eq(consents.userId, userId), eq(consents.type, 'location')))
    .orderBy(desc(consents.createdAt))
    .limit(1);

  if (rows.length > 0 && !rows[0].granted) {
    return false;
  }
  return true;
}

export async function createOrMergeIncident(
  db: AppDatabase,
  user: UserRow,
  input: {
    client_request_id: string;
    client_created_at?: string;
    location?: {
      lat: number;
      lng: number;
      accuracy_m?: number | null;
      captured_at?: string;
    };
    source_trigger?: string;
    emergency_type?: string | null;
  }
): Promise<{
  incident: IncidentDto;
  idempotent_replay: boolean;
  merged_into_existing: boolean;
}> {
  // 1. Idempotency check by (user_id, client_request_id)
  const [existingByClientReq] = await db
    .select()
    .from(incidents)
    .where(
      and(
        eq(incidents.userId, user.id),
        eq(incidents.clientRequestId, input.client_request_id)
      )
    )
    .limit(1);

  if (existingByClientReq) {
    const targetId = existingByClientReq.mergedIntoId || existingByClientReq.id;
    const hydrated = await getHydratedIncident(db, targetId, user.id);
    return {
      incident: hydrated,
      idempotent_replay: true,
      merged_into_existing: Boolean(existingByClientReq.mergedIntoId),
      notifiable_contacts_count: hydrated.notifiable_contacts_count ?? 0,
    };
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const sourceTrigger = input.source_trigger || 'button';
  const defaultExpiresAt =
    nowMs + config.locationRetentionDays * 24 * 60 * 60 * 1000;
  const allowLocation = input.location
    ? await isLocationCaptureAllowed(db, user.id)
    : false;

  // 2. Duplicate detection within configurable window while an incident is open
  const openRows = await db
    .select()
    .from(incidents)
    .where(
      and(
        eq(incidents.userId, user.id),
        inArray(incidents.status, OPEN_INCIDENT_STATUSES),
        isNull(incidents.mergedIntoId)
      )
    )
    .orderBy(desc(incidents.createdAt));

  const windowMs = config.duplicateIncidentWindowSeconds * 1000;
  const recentOpen = openRows.find((inc) => {
    const createdMs = new Date(inc.createdAt).getTime();
    return nowMs - createdMs <= windowMs;
  });

  if (recentOpen) {
    const duplicateIncidentId = crypto.randomUUID();
    const isRealDuress = Boolean(recentOpen.isDuress);
    const initialDuplicateStatus = isRealDuress
      ? 'TRIGGERED'
      : recentOpen.status;

    await db.transaction(async (tx) => {
      await tx.insert(incidents).values({
        id: duplicateIncidentId,
        userId: user.id,
        status: initialDuplicateStatus,
        emergencyType: input.emergency_type ?? recentOpen.emergencyType ?? null,
        clientRequestId: input.client_request_id,
        createdAt: nowIso,
        activatedAt: isRealDuress ? null : recentOpen.activatedAt,
        closedAt: isRealDuress ? null : nowIso,
        mergedIntoId: recentOpen.id,
        sourceTrigger,
        isDuress: false,
      });

      await tx.insert(incidentEvents).values({
        id: crypto.randomUUID(),
        incidentId: duplicateIncidentId,
        fromStatus: null,
        toStatus: initialDuplicateStatus,
        actorType: 'user',
        actorId: user.id,
        note: `Duplicate trigger merged into open incident ${recentOpen.id}`,
        createdAt: nowIso,
      });

      await tx.insert(incidentEvents).values({
        id: crypto.randomUUID(),
        incidentId: recentOpen.id,
        fromStatus: recentOpen.status,
        toStatus: recentOpen.status,
        actorType: 'user',
        actorId: user.id,
        note: `Merged duplicate incident ${duplicateIncidentId} (client_request_id=${input.client_request_id})`,
        createdAt: nowIso,
      });

      if (input.location && allowLocation) {
        await tx.insert(locationSamples).values({
          id: crypto.randomUUID(),
          incidentId: recentOpen.id,
          lat: input.location.lat,
          lng: input.location.lng,
          accuracyM: input.location.accuracy_m ?? null,
          capturedAt: input.location.captured_at || nowIso,
          expiresAt: defaultExpiresAt,
        });
      }
    });

    if (isRealDuress) {
      // Real duress incident stays the one that is active; present a normal new alert flow (TRIGGERED -> ACTIVE/NOTIFIED) to the owner
      const cancelWindowMs = (user.cancelWindowSeconds ?? 5) * 1000;
      scheduleShadowMergedActivation(
        duplicateIncidentId,
        recentOpen.id,
        cancelWindowMs,
        db
      );
      const shadowHydrated = await getHydratedIncident(
        db,
        duplicateIncidentId,
        user.id
      );
      return {
        incident: shadowHydrated,
        idempotent_replay: false,
        merged_into_existing: true,
        notifiable_contacts_count:
          shadowHydrated.notifiable_contacts_count ?? 0,
      };
    }

    const hydrated = await getHydratedIncident(db, recentOpen.id, user.id);
    return {
      incident: {
        ...hydrated,
        merged_into_id: recentOpen.id,
      },
      idempotent_replay: false,
      merged_into_existing: true,
      notifiable_contacts_count: hydrated.notifiable_contacts_count ?? 0,
    };
  }

  // 3. Create fresh TRIGGERED incident
  const newIncidentId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    await tx.insert(incidents).values({
      id: newIncidentId,
      userId: user.id,
      status: 'TRIGGERED',
      emergencyType: input.emergency_type ?? null,
      clientRequestId: input.client_request_id,
      createdAt: nowIso,
      activatedAt: null,
      closedAt: null,
      mergedIntoId: null,
      sourceTrigger,
      isDuress: false,
    });

    await tx.insert(incidentEvents).values({
      id: crypto.randomUUID(),
      incidentId: newIncidentId,
      fromStatus: null,
      toStatus: 'TRIGGERED',
      actorType: 'user',
      actorId: user.id,
      note: `Incident triggered via ${sourceTrigger}`,
      createdAt: nowIso,
    });

    if (input.location && allowLocation) {
      await tx.insert(locationSamples).values({
        id: crypto.randomUUID(),
        incidentId: newIncidentId,
        lat: input.location.lat,
        lng: input.location.lng,
        accuracyM: input.location.accuracy_m ?? null,
        capturedAt: input.location.captured_at || nowIso,
        expiresAt: defaultExpiresAt,
      });
    }
  });

  // Schedule automatic TRIGGERED -> ACTIVE transition after user's cancel window
  const cancelWindowMs = (user.cancelWindowSeconds ?? 5) * 1000;
  scheduleIncidentActivation(newIncidentId, cancelWindowMs, db);

  const realHydrated = await getHydratedIncident(db, newIncidentId, undefined, {
    viewerRole: 'system',
  });
  broadcastIncidentUpdate(realHydrated);

  const hydrated = maskIncidentForOwner(realHydrated);
  return {
    incident: hydrated,
    idempotent_replay: false,
    merged_into_existing: false,
    notifiable_contacts_count: hydrated.notifiable_contacts_count ?? 0,
  };
}

export async function cancelIncidentForUser(
  db: AppDatabase,
  user: UserRow,
  incidentId: string,
  input: { pin?: string; note?: string }
): Promise<{
  status: string;
  incident: IncidentDto;
  notifiable_contacts_count: number;
  _duress_keep_location_active?: boolean;
}> {
  const [inc] = await db
    .select()
    .from(incidents)
    .where(and(eq(incidents.id, incidentId), eq(incidents.userId, user.id)))
    .limit(1);

  if (!inc) {
    throw new HttpError(404, 'Incident not found.');
  }

  if (inc.status !== 'TRIGGERED') {
    throw new HttpError(
      400,
      `Incident cannot be cancelled in status ${inc.status}. Cancellation is only allowed during the TRIGGERED cancel window.`
    );
  }

  // Reload latest user settings (in case cancelPinHash or duressPinHash was just updated)
  const [freshUser] = await db
    .select()
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  const currentUser = freshUser || user;

  const hasDuressPin = Boolean(currentUser.duressPinHash);
  const hasCancelPin = Boolean(currentUser.cancelPinHash);

  if (hasDuressPin || hasCancelPin) {
    // Enforce per-incident PIN attempt rate limit without revealing that a limit exists
    if ((inc.pinAttempts ?? 0) >= config.pinMaxAttemptsPerIncident) {
      throw new HttpError(400, 'Invalid PIN.');
    }

    if (!input.pin || input.pin.trim() === '') {
      throw new HttpError(400, 'PIN is required to cancel an alert.');
    }

    const pin = input.pin.trim();
    const isDuressMatch =
      hasDuressPin &&
      (await verifyDuressPinHash(
        currentUser.id,
        pin,
        currentUser.duressPinHash!
      ));
    const isCancelMatch =
      hasCancelPin &&
      (await verifyCancelPinHash(
        currentUser.id,
        pin,
        currentUser.cancelPinHash!
      ));

    if (isDuressMatch) {
      // Duress PIN matched! Do NOT cancel; set is_duress = true and record audit event
      const nowIso = new Date().toISOString();
      await db.transaction(async (tx) => {
        await tx
          .update(incidents)
          .set({ isDuress: true })
          .where(eq(incidents.id, incidentId));

        await tx.insert(incidentEvents).values({
          id: crypto.randomUUID(),
          incidentId,
          fromStatus: inc.status,
          toStatus: inc.status,
          actorType: 'user',
          actorId: currentUser.id,
          note: 'Duress PIN supplied during cancel window; incident kept active silently',
          createdAt: nowIso,
        });
      });

      logger.warn(`Duress mode activated silently on incident ${incidentId}`);

      const realHydrated = await getHydratedIncident(db, incidentId, undefined, {
        viewerRole: 'system',
      });
      broadcastIncidentUpdate(realHydrated);

      // Return an identical-looking CANCELLED response so any coercer watching the screen sees a normal cancellation
      const spoofedDto = maskIncidentForOwner(realHydrated);

      return {
        status: 'CANCELLED',
        incident: spoofedDto,
        notifiable_contacts_count: spoofedDto.notifiable_contacts_count ?? 0,
        _duress_keep_location_active: true,
      };
    }

    if (!isCancelMatch) {
      const nextAttempts = (inc.pinAttempts ?? 0) + 1;
      await db
        .update(incidents)
        .set({ pinAttempts: nextAttempts })
        .where(eq(incidents.id, incidentId));
      throw new HttpError(400, 'Invalid PIN.');
    }
  }

  // Normal cancellation inside cancel window
  cancelScheduledActivation(incidentId);
  await transition(
    incidentId,
    'CANCELLED',
    { type: 'user', id: currentUser.id },
    input.note || 'Cancelled by user within cancel window',
    db
  );

  // Note: If this incident is a shadow duplicate (inc.mergedIntoId is set),
  // we NEVER cancel the real underlying incident (especially if the real incident is under duress).
  const realHydrated = await getHydratedIncident(db, incidentId, undefined, {
    viewerRole: 'system',
  });
  broadcastIncidentUpdate(realHydrated);

  const ownerHydrated = maskIncidentForOwner(realHydrated);
  return {
    status: 'CANCELLED',
    incident: ownerHydrated,
    notifiable_contacts_count: ownerHydrated.notifiable_contacts_count ?? 0,
  };
}

export async function addIncidentLocationSample(
  db: AppDatabase,
  user: UserRow,
  incidentId: string,
  input: {
    lat: number;
    lng: number;
    accuracy_m?: number | null;
    captured_at?: string;
  }
): Promise<LocationSampleDto> {
  const [inc] = await db
    .select()
    .from(incidents)
    .where(and(eq(incidents.id, incidentId), eq(incidents.userId, user.id)))
    .limit(1);

  if (!inc) {
    throw new HttpError(404, 'Incident not found.');
  }

  if (!OPEN_INCIDENT_STATUSES.includes(inc.status)) {
    throw new HttpError(
      400,
      `Cannot record location sample for closed incident in status ${inc.status}.`
    );
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const expiresAt = nowMs + config.locationRetentionDays * 24 * 60 * 60 * 1000;

  const targetIncidentId = inc.mergedIntoId || incidentId;
  const sample: LocationSampleRow = {
    id: crypto.randomUUID(),
    incidentId: targetIncidentId,
    lat: input.lat,
    lng: input.lng,
    accuracyM: input.accuracy_m ?? null,
    capturedAt: input.captured_at || nowIso,
    expiresAt,
  };

  await db.insert(locationSamples).values(sample);
  return toLocationSampleDto(sample);
}

export async function setIncidentEmergencyType(
  db: AppDatabase,
  user: UserRow,
  incidentId: string,
  emergencyType: string
): Promise<IncidentDto> {
  const [inc] = await db
    .select()
    .from(incidents)
    .where(and(eq(incidents.id, incidentId), eq(incidents.userId, user.id)))
    .limit(1);

  if (!inc) {
    throw new HttpError(404, 'Incident not found.');
  }

  const nowIso = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx
      .update(incidents)
      .set({ emergencyType })
      .where(eq(incidents.id, incidentId));

    if (inc.mergedIntoId) {
      await tx
        .update(incidents)
        .set({ emergencyType })
        .where(eq(incidents.id, inc.mergedIntoId));
    }

    await tx.insert(incidentEvents).values({
      id: crypto.randomUUID(),
      incidentId,
      fromStatus: inc.status,
      toStatus: inc.status,
      actorType: 'user',
      actorId: user.id,
      note: `Emergency type set to ${emergencyType}`,
      createdAt: nowIso,
    });
  });

  const realHydrated = await getHydratedIncident(db, incidentId, undefined, {
    viewerRole: 'system',
  });
  broadcastIncidentUpdate(realHydrated);

  return maskIncidentForOwner(realHydrated);
}

export async function resolveIncidentForUser(
  db: AppDatabase,
  user: UserRow,
  incidentId: string,
  input: { resolution: 'RESOLVED' | 'FALSE_ALARM'; note?: string }
): Promise<IncidentDto> {
  const isResponderOrAdmin =
    user.role === 'responder' || user.role === 'admin';

  const [inc] = await db
    .select()
    .from(incidents)
    .where(
      isResponderOrAdmin
        ? eq(incidents.id, incidentId)
        : and(eq(incidents.id, incidentId), eq(incidents.userId, user.id))
    )
    .limit(1);

  if (!inc) {
    throw new HttpError(404, 'Incident not found.');
  }

  // Fix 2: On an incident with is_duress = true, the owner's "I'm safe" (resolve)
  // must NOT close the real incident. Show her a normal-looking closed screen,
  // keep the real incident active, and only allow real closure by a responder or trusted contact.
  if (inc.isDuress && !isResponderOrAdmin) {
    const nowIso = new Date().toISOString();
    await db.insert(incidentEvents).values({
      id: crypto.randomUUID(),
      incidentId: inc.id,
      fromStatus: inc.status,
      toStatus: inc.status,
      actorType: 'user',
      actorId: user.id,
      note: 'Owner attempted resolve while incident is under duress; kept active silently',
      createdAt: nowIso,
    });

    const realHydrated = await getHydratedIncident(db, incidentId, undefined, {
      viewerRole: 'system',
    });
    const masked = maskIncidentForOwner(realHydrated);
    return {
      ...masked,
      status: input.resolution,
      closed_at: nowIso,
    };
  }

  cancelScheduledActivation(incidentId);

  if (inc.status === 'TRIGGERED') {
    await transition(
      incidentId,
      'ACTIVE',
      {
        type: isResponderOrAdmin ? 'responder' : 'user',
        id: user.id,
      },
      'Activated prior to immediate resolution',
      db
    );
  }

  await transition(
    incidentId,
    input.resolution,
    {
      type: isResponderOrAdmin ? 'responder' : 'user',
      id: user.id,
    },
    input.note || `Incident marked ${input.resolution} by ${user.role}`,
    db
  );

  // Fix 3: If this is a merged/shadow incident, only propagate resolution to the real incident
  // if the real incident is NOT under duress (or if a responder/admin is closing it).
  if (inc.mergedIntoId) {
    const [realInc] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, inc.mergedIntoId))
      .limit(1);
    if (
      realInc &&
      OPEN_INCIDENT_STATUSES.includes(realInc.status) &&
      (!realInc.isDuress || isResponderOrAdmin)
    ) {
      cancelScheduledActivation(inc.mergedIntoId);
      if (realInc.status === 'TRIGGERED') {
        await transition(
          realInc.id,
          'ACTIVE',
          {
            type: isResponderOrAdmin ? 'responder' : 'user',
            id: user.id,
          },
          'Activated prior to immediate resolution',
          db
        );
      }
      await transition(
        realInc.id,
        input.resolution,
        {
          type: isResponderOrAdmin ? 'responder' : 'user',
          id: user.id,
        },
        input.note || `Incident marked ${input.resolution} by user via merged trigger`,
        db
      );
    }
  }

  const realHydrated = await getHydratedIncident(db, incidentId, undefined, {
    viewerRole: 'system',
  });
  broadcastIncidentUpdate(realHydrated);

  return isResponderOrAdmin
    ? realHydrated
    : maskIncidentForOwner(realHydrated);
}

export async function getActiveIncidentForUser(
  db: AppDatabase,
  userId: string
): Promise<IncidentDto | null> {
  const [openInc] = await db
    .select()
    .from(incidents)
    .where(
      and(
        eq(incidents.userId, userId),
        inArray(incidents.status, OPEN_INCIDENT_STATUSES),
        isNull(incidents.mergedIntoId)
      )
    )
    .orderBy(desc(incidents.createdAt))
    .limit(1);

  if (!openInc) {
    return null;
  }

  // If the incident is under duress, the owner-facing response treats it as CANCELLED (not active)
  if (openInc.isDuress) {
    return null;
  }

  return getHydratedIncident(db, openInc.id, userId, { viewerRole: 'owner' });
}

export async function updateUserCancelWindow(
  db: AppDatabase,
  userId: string,
  cancelWindowSeconds: number
): Promise<{ cancel_window_seconds: number }> {
  await db
    .update(users)
    .set({ cancelWindowSeconds })
    .where(eq(users.id, userId));

  return { cancel_window_seconds: cancelWindowSeconds };
}

export async function updateUserCancelPin(
  db: AppDatabase,
  userId: string,
  pin: string | null
): Promise<{ cancel_pin_configured: boolean }> {
  const cancelPinHash = pin ? await hashCancelPin(userId, pin) : null;
  await db
    .update(users)
    .set({ cancelPinHash })
    .where(eq(users.id, userId));

  return { cancel_pin_configured: Boolean(cancelPinHash) };
}

export async function updateUserDuressPin(
  db: AppDatabase,
  userId: string,
  pin: string | null,
  cancelPin?: string | null
): Promise<{
  duress_pin_configured: boolean;
  cancel_pin_configured?: boolean;
}> {
  const duressPinHash = pin ? await hashDuressPin(userId, pin) : null;
  const updateFields: {
    duressPinHash: string | null;
    cancelPinHash?: string | null;
  } = { duressPinHash };

  if (cancelPin !== undefined) {
    updateFields.cancelPinHash = cancelPin
      ? await hashCancelPin(userId, cancelPin)
      : null;
  }

  await db
    .update(users)
    .set(updateFields)
    .where(eq(users.id, userId));

  return {
    duress_pin_configured: Boolean(duressPinHash),
    ...(cancelPin !== undefined
      ? { cancel_pin_configured: Boolean(updateFields.cancelPinHash) }
      : {}),
  };
}
