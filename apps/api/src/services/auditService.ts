import crypto from 'crypto';
import { and, desc, eq, gte } from 'drizzle-orm';
import { getDb, type AppDatabase } from '../core/db';
import {
  incidentAccessAudit,
  type IncidentAccessAuditRow,
} from '../db/schema';

export const RESPONDER_LIST_THROTTLE_MS = 5 * 60 * 1000;

export interface RecordIncidentAccessAuditParams {
  incidentId: string;
  actorType: 'contact' | 'responder' | 'admin';
  actorId: string;
  actorLabel?: string | null;
  action: string;
  detail?: string | null;
  nowMs?: number;
}

export async function recordIncidentAccessAudit(
  dbInstance: AppDatabase | undefined,
  params: RecordIncidentAccessAuditParams
): Promise<IncidentAccessAuditRow | null> {
  const db = dbInstance || getDb();
  const currentMs = params.nowMs ?? Date.now();

  // Follow-up 2: Responder LIST access is logged at most once per 5 minutes per responder.
  // Every incident DETAIL view and every action is always logged.
  if (
    params.actorType === 'responder' &&
    params.action === 'responder_list_incidents'
  ) {
    const cutoffIso = new Date(
      currentMs - RESPONDER_LIST_THROTTLE_MS
    ).toISOString();
    const [recentListAudit] = await db
      .select()
      .from(incidentAccessAudit)
      .where(
        and(
          eq(incidentAccessAudit.actorType, 'responder'),
          eq(incidentAccessAudit.actorId, params.actorId),
          eq(incidentAccessAudit.action, 'responder_list_incidents'),
          gte(incidentAccessAudit.createdAt, cutoffIso)
        )
      )
      .orderBy(desc(incidentAccessAudit.createdAt))
      .limit(1);

    if (recentListAudit) {
      return null;
    }
  }

  const row: IncidentAccessAuditRow = {
    id: crypto.randomUUID(),
    incidentId: params.incidentId,
    actorType: params.actorType,
    actorId: params.actorId,
    actorLabel: params.actorLabel ?? null,
    action: params.action,
    detail: params.detail ?? null,
    createdAt: new Date(currentMs).toISOString(),
  };

  await db.insert(incidentAccessAudit).values(row);
  return row;
}

export interface IncidentAccessAuditDto {
  id: string;
  incident_id: string;
  actor_type: 'contact' | 'responder' | 'admin';
  actor_id: string;
  actor_label: string | null;
  action: string;
  detail: string | null;
  created_at: string;
}

export async function listIncidentAccessAudit(
  dbInstance?: AppDatabase,
  incidentId?: string,
  actorType?: 'contact' | 'responder' | 'admin'
): Promise<IncidentAccessAuditDto[]> {
  const db = dbInstance || getDb();
  const rows = incidentId
    ? await db
        .select()
        .from(incidentAccessAudit)
        .where(eq(incidentAccessAudit.incidentId, incidentId))
        .orderBy(desc(incidentAccessAudit.createdAt))
    : await db
        .select()
        .from(incidentAccessAudit)
        .orderBy(desc(incidentAccessAudit.createdAt));

  const filtered = actorType
    ? rows.filter((r) => r.actorType === actorType)
    : rows;

  return filtered.map((r) => ({
    id: r.id,
    incident_id: r.incidentId,
    actor_type: r.actorType,
    actor_id: r.actorId,
    actor_label: r.actorLabel ?? null,
    action: r.action,
    detail: r.detail ?? null,
    created_at: r.createdAt,
  }));
}
