import crypto from 'crypto';
import { desc, eq } from 'drizzle-orm';
import { getDb, type AppDatabase } from '../core/db';
import { logger } from '../core/security';
import {
  resources,
  safetyPulses,
  type ResourceRow,
  type SafetyPulseRow,
} from '../db/schema';
import { HttpError } from './authService';

export interface ResourceDto {
  id: string;
  name: string;
  category: string;
  phone: string;
  description: string;
  available_hours: string;
  active: boolean;
}

export function toResourceDto(row: ResourceRow): ResourceDto {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    phone: row.phone,
    description: row.description,
    available_hours: row.availableHours,
    active: Boolean(row.active),
  };
}

/**
 * GET /api/resources
 * Searches active resources by text (`q`) and `category`.
 * Admins may optionally pass `include_inactive=true`.
 */
export async function listResources(
  dbInstance?: AppDatabase,
  filters?: {
    q?: string;
    category?: string;
    includeInactive?: boolean;
  }
): Promise<ResourceDto[]> {
  const db = dbInstance || getDb();
  const rows = await db.select().from(resources);

  const qNorm = (filters?.q || '').trim().toLowerCase();
  const catNorm = (filters?.category || '').trim().toLowerCase();

  const filtered = rows.filter((r) => {
    if (!filters?.includeInactive && !r.active) {
      return false;
    }
    if (catNorm && catNorm !== 'all' && r.category.toLowerCase() !== catNorm) {
      return false;
    }
    if (qNorm) {
      const haystack =
        `${r.name} ${r.category} ${r.phone} ${r.description} ${r.availableHours}`.toLowerCase();
      if (!haystack.includes(qNorm)) {
        return false;
      }
    }
    return true;
  });

  return filtered.map(toResourceDto);
}

export async function createResourceForAdmin(
  dbInstance: AppDatabase | undefined,
  input: {
    name: string;
    category: string;
    phone: string;
    description: string;
    available_hours: string;
    active?: boolean;
  }
): Promise<ResourceDto> {
  const db = dbInstance || getDb();
  const row: ResourceRow = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    category: input.category.trim(),
    phone: input.phone.trim(),
    description: input.description.trim(),
    availableHours: input.available_hours.trim(),
    active: input.active !== false,
  };

  await db.insert(resources).values(row);
  return toResourceDto(row);
}

export async function updateResourceForAdmin(
  dbInstance: AppDatabase | undefined,
  resourceId: string,
  input: Partial<{
    name: string;
    category: string;
    phone: string;
    description: string;
    available_hours: string;
    active: boolean;
  }>
): Promise<ResourceDto> {
  const db = dbInstance || getDb();
  const [existing] = await db
    .select()
    .from(resources)
    .where(eq(resources.id, resourceId))
    .limit(1);

  if (!existing) {
    throw new HttpError(404, 'Resource not found.');
  }

  const patch: Partial<ResourceRow> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.category !== undefined) patch.category = input.category.trim();
  if (input.phone !== undefined) patch.phone = input.phone.trim();
  if (input.description !== undefined)
    patch.description = input.description.trim();
  if (input.available_hours !== undefined)
    patch.availableHours = input.available_hours.trim();
  if (input.active !== undefined) patch.active = Boolean(input.active);

  await db.update(resources).set(patch).where(eq(resources.id, resourceId));

  const [updated] = await db
    .select()
    .from(resources)
    .where(eq(resources.id, resourceId))
    .limit(1);

  return toResourceDto(updated!);
}

export async function deleteResourceForAdmin(
  dbInstance: AppDatabase | undefined,
  resourceId: string
): Promise<{ deleted_id: string }> {
  const db = dbInstance || getDb();
  const [existing] = await db
    .select()
    .from(resources)
    .where(eq(resources.id, resourceId))
    .limit(1);

  if (!existing) {
    throw new HttpError(404, 'Resource not found.');
  }

  await db.delete(resources).where(eq(resources.id, resourceId));
  return { deleted_id: resourceId };
}

// ==========================================
// SAFETY PULSE (At most once a week per user)
// ==========================================

export const PULSE_WEEK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// In-memory tracker for weekly prompt cadence per user (so even if the user submits an ANONYMOUS pulse
// where user_id is NULL in the DB, or skips/dismisses it, the prompt still appears at most once a week per user without linking their user_id to the anonymous DB row).
const weeklyPulsePromptTracker = new Map<string, number>();

export function resetPulseTracker(): void {
  weeklyPulsePromptTracker.clear();
}

export interface PulseStatusDto {
  should_prompt: boolean;
  last_submitted_at: string | null;
  next_eligible_at: string | null;
}

export async function getPulseStatusForUser(
  dbInstance: AppDatabase | undefined,
  userId: string,
  nowMs: number = Date.now()
): Promise<PulseStatusDto> {
  const db = dbInstance || getDb();

  // Check both the non-anonymous DB rows for this user AND the in-memory weekly cadence tracker
  const [latestDbRow] = await db
    .select()
    .from(safetyPulses)
    .where(eq(safetyPulses.userId, userId))
    .orderBy(desc(safetyPulses.createdAt))
    .limit(1);

  const dbLastMs = latestDbRow ? new Date(latestDbRow.createdAt).getTime() : 0;
  const memLastMs = weeklyPulsePromptTracker.get(userId) || 0;
  const lastMs = Math.max(dbLastMs, memLastMs);

  if (lastMs > 0 && nowMs - lastMs < PULSE_WEEK_WINDOW_MS) {
    return {
      should_prompt: false,
      last_submitted_at: new Date(lastMs).toISOString(),
      next_eligible_at: new Date(lastMs + PULSE_WEEK_WINDOW_MS).toISOString(),
    };
  }

  return {
    should_prompt: true,
    last_submitted_at: lastMs > 0 ? new Date(lastMs).toISOString() : null,
    next_eligible_at: null,
  };
}

export interface SubmitPulseInput {
  safety_score: number;
  avoided_going_somewhere: boolean;
  anonymous?: boolean;
}

export interface SubmittedPulseDto {
  id: string;
  safety_score: number;
  avoided_going_somewhere: boolean;
  anonymous: boolean;
  created_at: string;
}

/**
 * POST /api/pulse
 * Two questions only:
 * 1) "How safe did you feel traveling this week? (1-5)"
 * 2) "Did you avoid going somewhere because of safety? (Yes/No)"
 * Enforces at most once a week per user.
 * For anonymous pulses: stores NO user_id (`user_id = NULL`) and ONLY the date (`YYYY-MM-DD`).
 */
export async function submitSafetyPulse(
  dbInstance: AppDatabase | undefined,
  userId: string,
  input: SubmitPulseInput,
  nowMs: number = Date.now()
): Promise<SubmittedPulseDto> {
  const db = dbInstance || getDb();

  const score = Number(input.safety_score);
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw new HttpError(422, 'safety_score must be an integer from 1 to 5.');
  }

  if (typeof input.avoided_going_somewhere !== 'boolean') {
    throw new HttpError(422, 'avoided_going_somewhere must be a boolean.');
  }

  // Enforce weekly cadence (at most once per 7 days per user)
  const status = await getPulseStatusForUser(db, userId, nowMs);
  if (!status.should_prompt) {
    throw new HttpError(
      429,
      'You have already completed or dismissed the weekly safety pulse within the last 7 days.'
    );
  }

  const isAnonymous = Boolean(input.anonymous);
  const fullIso = new Date(nowMs).toISOString();
  // Critical rule: For anonymous pulses store NO user_id and ONLY the date (YYYY-MM-DD)
  const createdAtValue = isAnonymous ? fullIso.slice(0, 10) : fullIso;
  const storedUserId = isAnonymous ? null : userId;

  const row: SafetyPulseRow = {
    id: crypto.randomUUID(),
    userId: storedUserId,
    safetyScore: score,
    avoidedGoingSomewhere: input.avoided_going_somewhere,
    isDemo: false,
    createdAt: createdAtValue,
  };

  await db.insert(safetyPulses).values(row);

  // Record timestamp in weekly cadence tracker so prompt stays suppressed for 7 days
  weeklyPulsePromptTracker.set(userId, nowMs);

  logger.info('[SafetyPulse] Recorded weekly safety pulse response');

  return {
    id: row.id,
    safety_score: row.safetyScore,
    avoided_going_somewhere: row.avoidedGoingSomewhere,
    anonymous: isAnonymous,
    created_at: row.createdAt,
  };
}
