import crypto from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { getDb, type AppDatabase } from '../core/db';
import { logger } from '../core/security';
import {
  consents,
  DEFAULT_ORGANIZATION_ZONE,
  incidentAssignments,
  incidentEvents,
  incidents,
  locationSamples,
  notifications,
  OPEN_INCIDENT_STATUSES,
  responders,
  TERMINAL_INCIDENT_STATUSES,
  users,
  type IncidentAssignmentRow,
  type IncidentEventRow,
  type IncidentStatus,
  type ResponderRow,
} from '../db/schema';
import { defaultEmergencyGateway } from '../providers/emergencyGateway';
import { HttpError } from './authService';
import { recordIncidentAccessAudit } from './auditService';
import { DURESS_SAFETY_NOTICE_EN } from './contactIncidentTokenService';
import { getHydratedIncident } from './incidentService';
import { transition } from './incidentStateMachine';
import { cancelScheduledEscalation } from './scheduler';
import { broadcastIncidentUpdate } from './wsHub';

export interface ResponderProfileDto {
  id: string;
  user_id: string;
  name: string;
  phone_e164: string;
  organization_zone: string;
  active: boolean;
  on_duty: boolean;
}

export interface ResponderIncidentListItemDto {
  id: string;
  user_first_name: string;
  organization_zone: string;
  status: IncidentStatus;
  emergency_type: string | null;
  source_trigger: string;
  is_duress: boolean;
  duress_notice: string | null;
  created_at: string;
  activated_at: string | null;
  closed_at: string | null;
  acknowledged_by_responder: boolean;
  assigned_responder_user_ids: string[];
  latest_location: {
    lat: number;
    lng: number;
    accuracy_m: number | null;
    captured_at: string;
  } | null;
}

export interface ResponderIncidentDetailDto extends ResponderIncidentListItemDto {
  user_phone_e164: string | null;
  mock_112_gateway?: {
    is_mock: true;
    label: 'MOCK';
    provider: string;
    status: string;
    reference_id: string | null;
  };
  events: Array<{
    id: string;
    incident_id: string;
    from_status: IncidentStatus | null;
    to_status: IncidentStatus;
    actor_type: string;
    actor_id: string | null;
    note: string | null;
    created_at: string;
  }>;
  assignments: Array<{
    id: string;
    responder_id: string;
    responder_user_id: string;
    organization_zone: string;
    assigned_by_user_id: string | null;
    acknowledged_at: string | null;
    created_at: string;
  }>;
}

function extractFirstName(fullName: string): string {
  const trimmed = (fullName || '').trim();
  if (!trimmed) return 'SAATHI User';
  return trimmed.split(/\s+/)[0];
}

async function hasActiveLocationConsent(
  db: AppDatabase,
  userId: string
): Promise<boolean> {
  const rows = await db
    .select()
    .from(consents)
    .where(and(eq(consents.userId, userId), eq(consents.type, 'location')))
    .orderBy(desc(consents.createdAt))
    .limit(1);

  if (rows.length === 0) {
    return false;
  }
  return Boolean(rows[0].granted);
}

/**
 * Ensures a responder profile row exists for a user with role === 'responder'.
 */
export async function ensureResponderProfileForUser(
  db: AppDatabase,
  userId: string
): Promise<ResponderRow> {
  const [existing] = await db
    .select()
    .from(responders)
    .where(eq(responders.userId, userId))
    .limit(1);

  if (existing) {
    return existing;
  }

  const [userRow] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!userRow || userRow.role !== 'responder') {
    throw new HttpError(403, 'Responder profile not found or unauthorized.');
  }

  const nowIso = new Date().toISOString();
  const created: ResponderRow = {
    id: crypto.randomUUID(),
    userId: userRow.id,
    organizationZone: userRow.organizationZone || DEFAULT_ORGANIZATION_ZONE,
    active: true,
    onDuty: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await db.insert(responders).values(created);
  return created;
}

export async function listActiveRespondersInZone(
  db: AppDatabase,
  organizationZone: string
): Promise<ResponderProfileDto[]> {
  const rows = await db
    .select({
      responder: responders,
      user: users,
    })
    .from(responders)
    .innerJoin(users, eq(responders.userId, users.id))
    .where(eq(responders.organizationZone, organizationZone));

  return rows.map(({ responder, user }) => ({
    id: responder.id,
    user_id: responder.userId,
    name: user.name,
    phone_e164: user.phoneE164,
    organization_zone: responder.organizationZone,
    active: responder.active,
    on_duty: responder.onDuty,
  }));
}

/**
 * Modular, easy-to-replace routing rule:
 * When an incident becomes ACTIVE, route it to all active, on-duty responders
 * of the user's organization_zone and store in `incident_assignments`.
 */
export async function routeActiveIncidentToResponders(
  incidentId: string,
  dbInstance?: AppDatabase
): Promise<IncidentAssignmentRow[]> {
  const db = dbInstance || getDb();
  const [inc] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, incidentId))
    .limit(1);

  if (!inc) {
    return [];
  }

  const [owner] = await db
    .select()
    .from(users)
    .where(eq(users.id, inc.userId))
    .limit(1);

  const orgZone = owner?.organizationZone || DEFAULT_ORGANIZATION_ZONE;

  const eligibleResponders = await db
    .select()
    .from(responders)
    .where(
      and(
        eq(responders.organizationZone, orgZone),
        eq(responders.active, true),
        eq(responders.onDuty, true)
      )
    );

  const nowIso = new Date().toISOString();
  const assignments: IncidentAssignmentRow[] = [];

  for (const resp of eligibleResponders) {
    const [existingAssign] = await db
      .select()
      .from(incidentAssignments)
      .where(
        and(
          eq(incidentAssignments.incidentId, incidentId),
          eq(incidentAssignments.responderId, resp.id)
        )
      )
      .limit(1);

    if (existingAssign) {
      assignments.push(existingAssign);
      continue;
    }

    const row: IncidentAssignmentRow = {
      id: crypto.randomUUID(),
      incidentId,
      responderId: resp.id,
      responderUserId: resp.userId,
      organizationZone: orgZone,
      assignedByUserId: null,
      acknowledgedAt: null,
      createdAt: nowIso,
    };

    await db.insert(incidentAssignments).values(row);
    assignments.push(row);
  }

  return assignments;
}

/**
 * Checks whether a responder has acknowledged this incident (or the incident is already
 * in ACKNOWLEDGED / RESPONDING / RESOLVED / FALSE_ALARM state after responder acknowledgement).
 */
async function hasResponderAcknowledgedIncident(
  db: AppDatabase,
  incidentId: string,
  responderId: string,
  responderUserId: string
): Promise<boolean> {
  const [assignment] = await db
    .select()
    .from(incidentAssignments)
    .where(
      and(
        eq(incidentAssignments.incidentId, incidentId),
        eq(incidentAssignments.responderId, responderId)
      )
    )
    .limit(1);

  if (assignment?.acknowledgedAt) {
    return true;
  }

  const events = await db
    .select()
    .from(incidentEvents)
    .where(
      and(
        eq(incidentEvents.incidentId, incidentId),
        eq(incidentEvents.actorType, 'responder')
      )
    );

  return events.some(
    (ev) =>
      ev.actorId === responderUserId &&
      (ev.toStatus === 'ACKNOWLEDGED' || ev.toStatus === 'RESPONDING')
  );
}

/**
 * Verifies that an incident was routed to this responder's organization_zone.
 */
async function verifyIncidentRoutedToResponderOrg(
  db: AppDatabase,
  incidentId: string,
  responderRow: ResponderRow
): Promise<{
  incident: typeof incidents.$inferSelect;
  owner: typeof users.$inferSelect;
  assignments: IncidentAssignmentRow[];
}> {
  const [inc] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, incidentId))
    .limit(1);

  if (!inc) {
    throw new HttpError(404, 'Incident not found.');
  }

  const assignments = await db
    .select()
    .from(incidentAssignments)
    .where(eq(incidentAssignments.incidentId, incidentId));

  const routedToOrg = assignments.some(
    (a) => a.organizationZone === responderRow.organizationZone
  );

  if (!routedToOrg) {
    throw new HttpError(
      403,
      'This incident is not routed to your organization zone.'
    );
  }

  const [owner] = await db
    .select()
    .from(users)
    .where(eq(users.id, inc.userId))
    .limit(1);

  if (!owner) {
    throw new HttpError(404, 'Incident owner not found.');
  }

  return { incident: inc, owner, assignments };
}

/**
 * GET /api/responder/incidents
 * Returns ONLY incidents routed to this responder's organization; open first.
 * Responders see the MINIMUM needed: first name, emergency type, time, latest location (only if location consent active).
 */
export async function listResponderIncidents(
  dbInstance: AppDatabase | undefined,
  responderUserId: string
): Promise<{
  responder: ResponderProfileDto;
  colleagues: ResponderProfileDto[];
  incidents: ResponderIncidentListItemDto[];
}> {
  const db = dbInstance || getDb();
  const responderRow = await ensureResponderProfileForUser(db, responderUserId);
  const [responderUser] = await db
    .select()
    .from(users)
    .where(eq(users.id, responderUserId))
    .limit(1);

  const colleagues = await listActiveRespondersInZone(
    db,
    responderRow.organizationZone
  );

  const orgAssignments = await db
    .select()
    .from(incidentAssignments)
    .where(
      eq(incidentAssignments.organizationZone, responderRow.organizationZone)
    );

  const uniqueIncidentIds = Array.from(
    new Set(orgAssignments.map((a) => a.incidentId))
  );

  const items: ResponderIncidentListItemDto[] = [];

  for (const incidentId of uniqueIncidentIds) {
    const [inc] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, incidentId))
      .limit(1);

    if (!inc || inc.mergedIntoId) {
      continue;
    }

    const [owner] = await db
      .select()
      .from(users)
      .where(eq(users.id, inc.userId))
      .limit(1);

    const incAssignments = orgAssignments.filter(
      (a) => a.incidentId === incidentId
    );
    const ackedByThisResponder = await hasResponderAcknowledgedIncident(
      db,
      incidentId,
      responderRow.id,
      responderUserId
    );

    const locationConsent = await hasActiveLocationConsent(db, inc.userId);
    let latestPoint: ResponderIncidentListItemDto['latest_location'] = null;
    if (locationConsent) {
      const [sample] = await db
        .select()
        .from(locationSamples)
        .where(eq(locationSamples.incidentId, incidentId))
        .orderBy(desc(locationSamples.capturedAt))
        .limit(1);

      if (sample) {
        latestPoint = {
          lat: sample.lat,
          lng: sample.lng,
          accuracy_m: sample.accuracyM ?? null,
          captured_at: sample.capturedAt,
        };
      }
    }

    const isDuress = Boolean(inc.isDuress);

    items.push({
      id: inc.id,
      user_first_name: extractFirstName(owner?.name || 'SAATHI User'),
      organization_zone: responderRow.organizationZone,
      status: inc.status,
      emergency_type: inc.emergencyType ?? null,
      source_trigger: inc.sourceTrigger || 'button',
      is_duress: isDuress,
      duress_notice: isDuress ? DURESS_SAFETY_NOTICE_EN : null,
      created_at: inc.createdAt,
      activated_at: inc.activatedAt ?? null,
      closed_at: inc.closedAt ?? null,
      acknowledged_by_responder: ackedByThisResponder,
      assigned_responder_user_ids: incAssignments.map(
        (a) => a.responderUserId
      ),
      latest_location: latestPoint,
    });
  }

  // Sort: open incidents first, then newest created_at descending
  items.sort((a, b) => {
    const aOpen = OPEN_INCIDENT_STATUSES.includes(a.status) ? 0 : 1;
    const bOpen = OPEN_INCIDENT_STATUSES.includes(b.status) ? 0 : 1;
    if (aOpen !== bOpen) {
      return aOpen - bOpen;
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  await recordIncidentAccessAudit(db, {
    incidentId: items[0]?.id || `zone:${responderRow.organizationZone}`,
    actorType: 'responder',
    actorId: responderUserId,
    actorLabel: responderUser?.name || 'Responder',
    action: 'responder_list_incidents',
    detail: `Responder ${responderUser?.name || responderUserId} listed ${items.length} incident(s) in ${responderRow.organizationZone}`,
  });

  return {
    responder: {
      id: responderRow.id,
      user_id: responderRow.userId,
      name: responderUser?.name || 'Responder',
      phone_e164: responderUser?.phoneE164 || '',
      organization_zone: responderRow.organizationZone,
      active: responderRow.active,
      on_duty: responderRow.onDuty,
    },
    colleagues,
    incidents: items,
  };
}

/**
 * GET /api/responder/incidents/:id
 * Returns real status (including is_duress), latest location ONLY if user has location consent,
 * events timeline, and user_phone_e164 ONLY AFTER this responder has acknowledged.
 * No consent ledger and no other contacts' details are ever included.
 */
export async function getResponderIncidentDetail(
  dbInstance: AppDatabase | undefined,
  responderUserId: string,
  incidentId: string,
  options?: { skipAudit?: boolean }
): Promise<ResponderIncidentDetailDto> {
  const db = dbInstance || getDb();
  const responderRow = await ensureResponderProfileForUser(db, responderUserId);
  const [responderUser] = await db
    .select()
    .from(users)
    .where(eq(users.id, responderUserId))
    .limit(1);

  const { incident, owner, assignments } =
    await verifyIncidentRoutedToResponderOrg(db, incidentId, responderRow);

  if (!options?.skipAudit) {
    await recordIncidentAccessAudit(db, {
      incidentId: incident.id,
      actorType: 'responder',
      actorId: responderUserId,
      actorLabel: responderUser?.name || 'Responder',
      action: 'responder_view_incident',
      detail: `Responder ${responderUser?.name || responderUserId} viewed incident detail`,
    });
  }

  const ackedByThisResponder = await hasResponderAcknowledgedIncident(
    db,
    incident.id,
    responderRow.id,
    responderUserId
  );

  const locationConsent = await hasActiveLocationConsent(db, incident.userId);
  let latestPoint: ResponderIncidentDetailDto['latest_location'] = null;
  if (locationConsent) {
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
    }
  }

  const rawEvents = await db
    .select()
    .from(incidentEvents)
    .where(eq(incidentEvents.incidentId, incident.id));

  // Redact trusted contact names/IDs from event notes/actorIds so responder never sees other contacts' details
  const sanitizedEvents = rawEvents.map((ev: IncidentEventRow) => {
    if (ev.actorType === 'contact') {
      return {
        id: ev.id,
        incident_id: ev.incidentId,
        from_status: ev.fromStatus ?? null,
        to_status: ev.toStatus,
        actor_type: ev.actorType,
        actor_id: null,
        note: 'Trusted contact response recorded',
        created_at: ev.createdAt,
      };
    }
    return {
      id: ev.id,
      incident_id: ev.incidentId,
      from_status: ev.fromStatus ?? null,
      to_status: ev.toStatus,
      actor_type: ev.actorType,
      actor_id: ev.actorId ?? null,
      note: ev.note ?? null,
      created_at: ev.createdAt,
    };
  });

  const isDuress = Boolean(incident.isDuress);

  const gatewayNotifs = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.incidentId, incident.id),
        eq(notifications.recipientType, 'gateway_112')
      )
    )
    .orderBy(desc(notifications.createdAt))
    .limit(1);

  const mockReq = defaultEmergencyGateway.requests
    .slice()
    .reverse()
    .find((r) => r.incidentId === incident.id);

  const gatewayStatus = gatewayNotifs[0]?.status || (mockReq ? 'sent' : 'standby');

  return {
    id: incident.id,
    user_first_name: extractFirstName(owner.name),
    // Phone number is revealed ONLY after acknowledging
    user_phone_e164: ackedByThisResponder ? owner.phoneE164 : null,
    organization_zone: responderRow.organizationZone,
    status: incident.status,
    emergency_type: incident.emergencyType ?? null,
    source_trigger: incident.sourceTrigger || 'button',
    is_duress: isDuress,
    duress_notice: isDuress ? DURESS_SAFETY_NOTICE_EN : null,
    created_at: incident.createdAt,
    activated_at: incident.activatedAt ?? null,
    closed_at: incident.closedAt ?? null,
    acknowledged_by_responder: ackedByThisResponder,
    assigned_responder_user_ids: assignments.map((a) => a.responderUserId),
    latest_location: latestPoint,
    mock_112_gateway: {
      is_mock: true,
      label: 'MOCK',
      provider: defaultEmergencyGateway.providerName,
      status: gatewayStatus,
      reference_id: mockReq?.referenceId || gatewayNotifs[0]?.recipientRef || null,
    },
    events: sanitizedEvents,
    assignments: assignments.map((a) => ({
      id: a.id,
      responder_id: a.responderId,
      responder_user_id: a.responderUserId,
      organization_zone: a.organizationZone,
      assigned_by_user_id: a.assignedByUserId ?? null,
      acknowledged_at: a.acknowledgedAt ?? null,
      created_at: a.createdAt,
    })),
  };
}

export type ResponderActionType =
  | 'acknowledge'
  | 'assign'
  | 'note'
  | 'responding'
  | 'resolve'
  | 'false-alarm';

export async function performResponderIncidentAction(
  dbInstance: AppDatabase | undefined,
  responderUserId: string,
  incidentId: string,
  action: ResponderActionType,
  payload?: {
    note?: string;
    target_responder_user_id?: string;
  },
  options?: {
    simulationMarker?: string;
  }
): Promise<ResponderIncidentDetailDto> {
  const db = dbInstance || getDb();
  const responderRow = await ensureResponderProfileForUser(db, responderUserId);
  const [responderUser] = await db
    .select()
    .from(users)
    .where(eq(users.id, responderUserId))
    .limit(1);
  const responderName = responderUser?.name || 'Responder';

  const { incident } = await verifyIncidentRoutedToResponderOrg(
    db,
    incidentId,
    responderRow
  );

  if (
    TERMINAL_INCIDENT_STATUSES.includes(incident.status) &&
    action !== 'note'
  ) {
    throw new HttpError(
      400,
      `Incident is already closed (${incident.status}).`
    );
  }

  const nowIso = new Date().toISOString();
  const simPrefix = options?.simulationMarker
    ? `[simulated] (${options.simulationMarker}) `
    : '';
  const effectiveNote = payload?.note
    ? `${simPrefix}${payload.note}`
    : options?.simulationMarker
    ? `${simPrefix}Responder ${responderName} executed ${action}`
    : undefined;

  await recordIncidentAccessAudit(db, {
    incidentId: incident.id,
    actorType: 'responder',
    actorId: responderUserId,
    actorLabel: options?.simulationMarker
      ? `${responderName} (simulated)`
      : responderName,
    action: options?.simulationMarker
      ? `simulated:responder_action:${action}`
      : `responder_action:${action}`,
    detail:
      effectiveNote ||
      payload?.target_responder_user_id ||
      `Responder ${responderName} executed ${action}`,
  });

  if (action === 'acknowledge') {
    // Stop escalation ladder immediately on responder acknowledge
    cancelScheduledEscalation(incident.id);

    // Ensure an assignment row exists for this responder and mark acknowledgedAt
    const [existingAssign] = await db
      .select()
      .from(incidentAssignments)
      .where(
        and(
          eq(incidentAssignments.incidentId, incident.id),
          eq(incidentAssignments.responderId, responderRow.id)
        )
      )
      .limit(1);

    if (existingAssign) {
      if (!existingAssign.acknowledgedAt) {
        await db
          .update(incidentAssignments)
          .set({ acknowledgedAt: nowIso })
          .where(eq(incidentAssignments.id, existingAssign.id));
      }
    } else {
      await db.insert(incidentAssignments).values({
        id: crypto.randomUUID(),
        incidentId: incident.id,
        responderId: responderRow.id,
        responderUserId: responderRow.userId,
        organizationZone: responderRow.organizationZone,
        assignedByUserId: responderUserId,
        acknowledgedAt: nowIso,
        createdAt: nowIso,
      });
    }

    if (incident.status === 'ACTIVE' || incident.status === 'NOTIFIED') {
      await transition(
        incident.id,
        'ACKNOWLEDGED',
        { type: 'responder', id: responderUserId },
        effectiveNote || `Responder ${responderName} acknowledged incident`,
        db
      );
    } else {
      await db.insert(incidentEvents).values({
        id: crypto.randomUUID(),
        incidentId: incident.id,
        fromStatus: incident.status,
        toStatus: incident.status,
        actorType: 'responder',
        actorId: responderUserId,
        note:
          effectiveNote || `Responder ${responderName} acknowledged incident`,
        createdAt: nowIso,
      });
    }
  } else if (action === 'responding') {
    cancelScheduledEscalation(incident.id);

    // Mark acknowledgedAt if not already set so phone is visible when responding
    const [existingAssign] = await db
      .select()
      .from(incidentAssignments)
      .where(
        and(
          eq(incidentAssignments.incidentId, incident.id),
          eq(incidentAssignments.responderId, responderRow.id)
        )
      )
      .limit(1);

    if (existingAssign && !existingAssign.acknowledgedAt) {
      await db
        .update(incidentAssignments)
        .set({ acknowledgedAt: nowIso })
        .where(eq(incidentAssignments.id, existingAssign.id));
    }

    if (
      incident.status === 'ACTIVE' ||
      incident.status === 'NOTIFIED' ||
      incident.status === 'ACKNOWLEDGED'
    ) {
      await transition(
        incident.id,
        'RESPONDING',
        { type: 'responder', id: responderUserId },
        effectiveNote || `Responder ${responderName} is responding`,
        db
      );
    } else {
      await db.insert(incidentEvents).values({
        id: crypto.randomUUID(),
        incidentId: incident.id,
        fromStatus: incident.status,
        toStatus: incident.status,
        actorType: 'responder',
        actorId: responderUserId,
        note: effectiveNote || `Responder ${responderName} is responding`,
        createdAt: nowIso,
      });
    }
  } else if (action === 'resolve') {
    cancelScheduledEscalation(incident.id);
    await transition(
      incident.id,
      'RESOLVED',
      { type: 'responder', id: responderUserId },
      effectiveNote || `Responder ${responderName} resolved incident`,
      db
    );
  } else if (action === 'false-alarm') {
    const reasonNote = (payload?.note || '').trim();
    if (!reasonNote) {
      throw new HttpError(
        422,
        'A note explaining why this is a false alarm is required.'
      );
    }
    cancelScheduledEscalation(incident.id);
    await transition(
      incident.id,
      'FALSE_ALARM',
      { type: 'responder', id: responderUserId },
      `False alarm marked by ${responderName}: ${reasonNote}`,
      db
    );
  } else if (action === 'assign') {
    const targetUserId = payload?.target_responder_user_id || responderUserId;
    const targetResponder = await ensureResponderProfileForUser(
      db,
      targetUserId
    );
    if (targetResponder.organizationZone !== responderRow.organizationZone) {
      throw new HttpError(
        403,
        'Cannot assign to a responder outside your organization zone.'
      );
    }

    const [existingTargetAssign] = await db
      .select()
      .from(incidentAssignments)
      .where(
        and(
          eq(incidentAssignments.incidentId, incident.id),
          eq(incidentAssignments.responderId, targetResponder.id)
        )
      )
      .limit(1);

    if (!existingTargetAssign) {
      await db.insert(incidentAssignments).values({
        id: crypto.randomUUID(),
        incidentId: incident.id,
        responderId: targetResponder.id,
        responderUserId: targetResponder.userId,
        organizationZone: targetResponder.organizationZone,
        assignedByUserId: responderUserId,
        acknowledgedAt: null,
        createdAt: nowIso,
      });
    } else {
      await db
        .update(incidentAssignments)
        .set({ assignedByUserId: responderUserId })
        .where(eq(incidentAssignments.id, existingTargetAssign.id));
    }

    await db.insert(incidentEvents).values({
      id: crypto.randomUUID(),
      incidentId: incident.id,
      fromStatus: incident.status,
      toStatus: incident.status,
      actorType: 'responder',
      actorId: responderUserId,
      note:
        payload?.note ||
        `Assigned incident to responder ${targetResponder.userId}`,
      createdAt: nowIso,
    });
  } else if (action === 'note') {
    const noteText = (payload?.note || '').trim();
    if (!noteText) {
      throw new HttpError(422, 'Note text is required.');
    }

    await db.insert(incidentEvents).values({
      id: crypto.randomUUID(),
      incidentId: incident.id,
      fromStatus: incident.status,
      toStatus: incident.status,
      actorType: 'responder',
      actorId: responderUserId,
      note: noteText,
      createdAt: nowIso,
    });
  }

  logger.info(
    `Responder action ${action} executed on incident ${incident.id} by ${responderUserId}`
  );

  // Broadcast update to WebSocket subscribers (owner gets masked payload if is_duress)
  const realHydrated = await getHydratedIncident(db, incident.id, undefined, {
    viewerRole: 'system',
  });
  broadcastIncidentUpdate(realHydrated);

  return getResponderIncidentDetail(db, responderUserId, incident.id, {
    skipAudit: true,
  });
}

export interface AdminResponderDto {
  id: string;
  name: string;
  organization_zone: string;
  active: boolean;
  on_duty: boolean;
}

export async function listAllRespondersForAdmin(
  dbInstance?: AppDatabase
): Promise<AdminResponderDto[]> {
  const db = dbInstance || getDb();
  const rows = await db
    .select({
      responder: responders,
      user: users,
    })
    .from(responders)
    .innerJoin(users, eq(responders.userId, users.id));

  return rows.map(({ responder, user }) => ({
    id: responder.id,
    name: user.name,
    organization_zone: responder.organizationZone,
    active: Boolean(responder.active),
    on_duty: Boolean(responder.onDuty),
  }));
}

export async function updateResponderForAdmin(
  dbInstance: AppDatabase | undefined,
  adminUser: { id: string; name: string },
  responderId: string,
  payload: { active?: boolean; on_duty?: boolean }
): Promise<{
  responder: AdminResponderDto;
  warning: string | null;
}> {
  const db = dbInstance || getDb();

  const [existing] = await db
    .select({
      responder: responders,
      user: users,
    })
    .from(responders)
    .innerJoin(users, eq(responders.userId, users.id))
    .where(eq(responders.id, responderId))
    .limit(1);

  if (!existing) {
    throw new HttpError(404, 'Responder not found.');
  }

  const nextActive =
    payload.active !== undefined ? payload.active : existing.responder.active;
  const nextOnDuty =
    payload.on_duty !== undefined ? payload.on_duty : existing.responder.onDuty;
  const nowIso = new Date().toISOString();

  await db
    .update(responders)
    .set({
      active: nextActive,
      onDuty: nextOnDuty,
      updatedAt: nowIso,
    })
    .where(eq(responders.id, responderId));

  const changes: string[] = [];
  if (payload.active !== undefined) {
    changes.push(`active: ${existing.responder.active} -> ${nextActive}`);
  }
  if (payload.on_duty !== undefined) {
    changes.push(`on_duty: ${existing.responder.onDuty} -> ${nextOnDuty}`);
  }

  await recordIncidentAccessAudit(db, {
    incidentId: `responder:${responderId}`,
    actorType: 'admin',
    actorId: adminUser.id,
    actorLabel: adminUser.name || 'Admin',
    action: 'admin_update_responder',
    detail: `Admin ${adminUser.name || adminUser.id} updated responder ${existing.user.name} (${responderId}): ${changes.join(', ') || 'no change'}`,
  });

  // Check if this organization_zone now has ZERO active, on-duty responders while having an open incident
  const zone = existing.responder.organizationZone;
  const remainingEligible = await db
    .select()
    .from(responders)
    .where(
      and(
        eq(responders.organizationZone, zone),
        eq(responders.active, true),
        eq(responders.onDuty, true)
      )
    );

  let warning: string | null = null;
  if (remainingEligible.length === 0) {
    // Check if there is any open primary incident for a user in this organization_zone (or routed to this zone)
    const openIncidents = await db
      .select({
        incident: incidents,
        owner: users,
      })
      .from(incidents)
      .innerJoin(users, eq(incidents.userId, users.id));

    const hasOpenInZone = openIncidents.some(
      ({ incident, owner }) =>
        !incident.mergedIntoId &&
        OPEN_INCIDENT_STATUSES.includes(incident.status) &&
        (owner.organizationZone || DEFAULT_ORGANIZATION_ZONE) === zone
    );

    if (hasOpenInZone) {
      warning = `Warning: ${zone} now has zero active, on-duty responders while an open incident exists in this zone. Routing only applies to incidents that become ACTIVE after this change; existing assignments are not changed.`;
    }
  }

  return {
    responder: {
      id: existing.responder.id,
      name: existing.user.name,
      organization_zone: zone,
      active: Boolean(nextActive),
      on_duty: Boolean(nextOnDuty),
    },
    warning,
  };
}

