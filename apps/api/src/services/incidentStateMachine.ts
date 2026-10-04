import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { config } from '../core/config';
import { getDb, type AppDatabase } from '../core/db';
import {
  incidentEvents,
  incidents,
  locationSamples,
  TERMINAL_INCIDENT_STATUSES,
  type IncidentActorType,
  type IncidentEventRow,
  type IncidentRow,
  type IncidentStatus,
} from '../db/schema';
import { HttpError } from './authService';

/**
 * Single source of truth for allowed incident state transitions per PROJECT_BRIEF.md:
 * TRIGGERED -> ACTIVE -> NOTIFIED -> ACKNOWLEDGED -> RESPONDING -> RESOLVED
 * Side exits: CANCELLED (during cancel window only), FALSE_ALARM, EXPIRED.
 */
export const ALLOWED_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  TRIGGERED: ['ACTIVE', 'CANCELLED', 'EXPIRED'],
  ACTIVE: [
    'NOTIFIED',
    'ACKNOWLEDGED',
    'RESPONDING',
    'RESOLVED',
    'FALSE_ALARM',
    'EXPIRED',
  ],
  NOTIFIED: [
    'ACKNOWLEDGED',
    'RESPONDING',
    'RESOLVED',
    'FALSE_ALARM',
    'EXPIRED',
  ],
  ACKNOWLEDGED: ['RESPONDING', 'RESOLVED', 'FALSE_ALARM', 'EXPIRED'],
  RESPONDING: ['RESOLVED', 'FALSE_ALARM', 'EXPIRED'],
  RESOLVED: [],
  CANCELLED: [],
  FALSE_ALARM: [],
  EXPIRED: [],
};

export interface TransitionActor {
  type: IncidentActorType;
  id?: string | null;
}

/**
 * Executes a state transition and writes an immutable row to `incident_events`
 * inside the SAME database transaction.
 */
export async function transition(
  incidentId: string,
  toStatus: IncidentStatus,
  actor: TransitionActor,
  note?: string | null,
  dbInstance?: AppDatabase
): Promise<{ incident: IncidentRow; event: IncidentEventRow }> {
  const db = dbInstance || getDb();

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(incidents)
      .where(eq(incidents.id, incidentId))
      .limit(1);

    if (!existing) {
      throw new HttpError(404, 'Incident not found.');
    }

    const allowed = ALLOWED_TRANSITIONS[existing.status] || [];
    if (!allowed.includes(toStatus)) {
      throw new HttpError(
        400,
        `Invalid state transition from ${existing.status} to ${toStatus}.`
      );
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    const activatedAt =
      toStatus === 'ACTIVE' && !existing.activatedAt
        ? nowIso
        : existing.activatedAt;

    const isTerminal = TERMINAL_INCIDENT_STATUSES.includes(toStatus);
    const closedAt =
      isTerminal && !existing.closedAt ? nowIso : existing.closedAt;

    await tx
      .update(incidents)
      .set({
        status: toStatus,
        activatedAt,
        closedAt,
      })
      .where(eq(incidents.id, incidentId));

    if (isTerminal) {
      const retentionExpiresAt =
        nowMs + config.locationRetentionDays * 24 * 60 * 60 * 1000;
      await tx
        .update(locationSamples)
        .set({ expiresAt: retentionExpiresAt })
        .where(eq(locationSamples.incidentId, incidentId));
    }

    const eventRow: IncidentEventRow = {
      id: crypto.randomUUID(),
      incidentId,
      fromStatus: existing.status,
      toStatus,
      actorType: actor.type,
      actorId: actor.id ?? null,
      note: note ?? null,
      createdAt: nowIso,
    };

    await tx.insert(incidentEvents).values(eventRow);

    const updatedIncident: IncidentRow = {
      ...existing,
      status: toStatus,
      activatedAt,
      closedAt,
    };

    return { incident: updatedIncident, event: eventRow };
  });
}
