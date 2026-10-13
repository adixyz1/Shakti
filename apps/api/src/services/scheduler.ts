import { and, eq, inArray, isNull } from 'drizzle-orm';
import { config } from '../core/config';
import { getDb, type AppDatabase } from '../core/db';
import { logger } from '../core/security';
import {
  incidents,
  journeys,
  OPEN_INCIDENT_STATUSES,
  users,
} from '../db/schema';
import { type PushProvider } from '../providers/push';
import { type SmsProvider } from '../providers/sms';
import { getHydratedIncident } from './incidentService';
import { transition } from './incidentStateMachine';
import {
  lapseJourneyIfDue,
  sendJourneyReminderIfDue,
} from './journeyService';
import {
  dispatchFinalGatewayEscalation,
  dispatchInitialActiveNotifications,
  dispatchSecondaryEscalationNotifications,
  type NotificationProviders,
} from './notificationDispatcher';
import { broadcastIncidentUpdate } from './wsHub';

const activeTimers = new Map<string, NodeJS.Timeout>();
const escalationTimers = new Map<string, NodeJS.Timeout[]>();
const expiryTimers = new Map<string, NodeJS.Timeout>();
const journeyReminderTimers = new Map<string, NodeJS.Timeout>();
const journeyLapseTimers = new Map<string, NodeJS.Timeout>();

export interface EscalationScheduleOptions {
  step1DelayMs?: number;
  step2DelayMs?: number;
  autoExpireMs?: number;
  providers?: NotificationProviders;
}

export interface JourneyScheduleOptions {
  reminderLeadMs?: number;
  pushProvider?: PushProvider;
  smsProvider?: SmsProvider;
}

export function cancelScheduledActivation(incidentId: string): void {
  const timer = activeTimers.get(incidentId);
  if (timer) {
    clearTimeout(timer);
    activeTimers.delete(incidentId);
  }
  cancelScheduledEscalation(incidentId);
  cancelScheduledExpiry(incidentId);
}

export function cancelScheduledEscalation(incidentId: string): void {
  const timers = escalationTimers.get(incidentId);
  if (timers) {
    for (const t of timers) {
      clearTimeout(t);
    }
    escalationTimers.delete(incidentId);
  }
}

export function hasScheduledEscalation(incidentId: string): boolean {
  const timers = escalationTimers.get(incidentId);
  return Boolean(timers && timers.length > 0);
}

export function cancelScheduledExpiry(incidentId: string): void {
  const timer = expiryTimers.get(incidentId);
  if (timer) {
    clearTimeout(timer);
    expiryTimers.delete(incidentId);
  }
}

export function cancelScheduledJourneyTimers(journeyId: string): void {
  const rTimer = journeyReminderTimers.get(journeyId);
  if (rTimer) {
    clearTimeout(rTimer);
    journeyReminderTimers.delete(journeyId);
  }
  const lTimer = journeyLapseTimers.get(journeyId);
  if (lTimer) {
    clearTimeout(lTimer);
    journeyLapseTimers.delete(journeyId);
  }
}

export function hasScheduledJourneyTimers(journeyId: string): boolean {
  return (
    journeyReminderTimers.has(journeyId) || journeyLapseTimers.has(journeyId)
  );
}

export function clearAllScheduledTimers(): void {
  for (const timer of activeTimers.values()) {
    clearTimeout(timer);
  }
  activeTimers.clear();
  for (const timers of escalationTimers.values()) {
    for (const t of timers) {
      clearTimeout(t);
    }
  }
  escalationTimers.clear();
  for (const timer of expiryTimers.values()) {
    clearTimeout(timer);
  }
  expiryTimers.clear();
  for (const timer of journeyReminderTimers.values()) {
    clearTimeout(timer);
  }
  journeyReminderTimers.clear();
  for (const timer of journeyLapseTimers.values()) {
    clearTimeout(timer);
  }
  journeyLapseTimers.clear();
}

function isUnacknowledgedOpenStatus(status: string): boolean {
  return status === 'ACTIVE' || status === 'NOTIFIED';
}

export function scheduleEscalationLadder(
  incidentId: string,
  dbInstance?: AppDatabase,
  options?: EscalationScheduleOptions
): void {
  cancelScheduledEscalation(incidentId);
  cancelScheduledExpiry(incidentId);

  const db = dbInstance || getDb();
  const step1DelayMs =
    options?.step1DelayMs ?? config.escalationStep1DelaySeconds * 1000;
  const step2DelayMs =
    options?.step2DelayMs ?? config.escalationStep2DelaySeconds * 1000;
  const autoExpireDelayMs =
    options?.autoExpireMs ?? config.incidentAutoExpireMinutes * 60 * 1000;

  const timers: NodeJS.Timeout[] = [];

  const t1 = setTimeout(async () => {
    try {
      const [current] = await db
        .select()
        .from(incidents)
        .where(eq(incidents.id, incidentId))
        .limit(1);

      if (current && isUnacknowledgedOpenStatus(current.status)) {
        await dispatchSecondaryEscalationNotifications(
          incidentId,
          db,
          options?.providers
        );
      }
    } catch (err) {
      logger.warn(
        `Escalation step 1 failed for incident ${incidentId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }, Math.max(0, step1DelayMs));

  const t2 = setTimeout(async () => {
    try {
      const [current] = await db
        .select()
        .from(incidents)
        .where(eq(incidents.id, incidentId))
        .limit(1);

      if (current && isUnacknowledgedOpenStatus(current.status)) {
        await dispatchFinalGatewayEscalation(
          incidentId,
          db,
          options?.providers
        );
      }
    } catch (err) {
      logger.warn(
        `Escalation step 2 (112 gateway) failed for incident ${incidentId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }, Math.max(0, step2DelayMs));

  const tExpire = setTimeout(async () => {
    try {
      const [current] = await db
        .select()
        .from(incidents)
        .where(eq(incidents.id, incidentId))
        .limit(1);

      if (current && OPEN_INCIDENT_STATUSES.includes(current.status)) {
        cancelScheduledEscalation(incidentId);
        cancelScheduledExpiry(incidentId);
        await transition(
          incidentId,
          'EXPIRED',
          { type: 'system', id: 'scheduler' },
          `Incident auto-expired after ${config.incidentAutoExpireMinutes} minutes`,
          db
        );
        logger.info(`Incident ${incidentId} auto-expired -> EXPIRED`);

        const realHydrated = await getHydratedIncident(
          db,
          incidentId,
          undefined,
          { viewerRole: 'system' }
        );
        broadcastIncidentUpdate(realHydrated);
      }
    } catch (err) {
      logger.warn(
        `Auto-expiry failed for incident ${incidentId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }, Math.max(0, autoExpireDelayMs));

  if (typeof t1.unref === 'function') t1.unref();
  if (typeof t2.unref === 'function') t2.unref();
  if (typeof tExpire.unref === 'function') tExpire.unref();

  timers.push(t1, t2);
  escalationTimers.set(incidentId, timers);
  expiryTimers.set(incidentId, tExpire);
}

export async function activateAndDispatchIncident(
  incidentId: string,
  dbInstance?: AppDatabase,
  options?: EscalationScheduleOptions
): Promise<void> {
  const db = dbInstance || getDb();
  const [current] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, incidentId))
    .limit(1);

  if (!current) {
    return;
  }

  if (current.status === 'TRIGGERED') {
    await transition(
      incidentId,
      'ACTIVE',
      { type: 'system', id: 'scheduler' },
      'Cancel window elapsed; incident activated automatically',
      db
    );
    logger.info(`Incident ${incidentId} transitioned TRIGGERED -> ACTIVE`);
    const realHydrated = await getHydratedIncident(db, incidentId, undefined, {
      viewerRole: 'system',
    });
    broadcastIncidentUpdate(realHydrated);
  }

  // Notify t=0 priority #1 contact (idempotent per contact/channel)
  await dispatchInitialActiveNotifications(
    incidentId,
    db,
    options?.providers
  );

  // Schedule Step 1 (t=N) and Step 2 (t=M) escalation ladder
  scheduleEscalationLadder(incidentId, db, options);
}

export function scheduleIncidentActivation(
  incidentId: string,
  delayMs: number,
  dbInstance?: AppDatabase,
  options?: EscalationScheduleOptions
): void {
  cancelScheduledActivation(incidentId);

  const safeDelay = Math.max(0, delayMs);
  const timer = setTimeout(async () => {
    activeTimers.delete(incidentId);
    try {
      await activateAndDispatchIncident(incidentId, dbInstance, options);
    } catch (err) {
      logger.warn(
        `Scheduler skipped or failed activating incident ${incidentId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }, safeDelay);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  activeTimers.set(incidentId, timer);
}

export function scheduleShadowMergedActivation(
  shadowIncidentId: string,
  realIncidentId: string,
  delayMs: number,
  dbInstance?: AppDatabase
): void {
  cancelScheduledActivation(shadowIncidentId);
  const db = dbInstance || getDb();
  const safeDelay = Math.max(0, delayMs);

  const timer = setTimeout(async () => {
    activeTimers.delete(shadowIncidentId);
    try {
      const [shadow] = await db
        .select()
        .from(incidents)
        .where(eq(incidents.id, shadowIncidentId))
        .limit(1);
      if (!shadow || shadow.status !== 'TRIGGERED') {
        return;
      }

      const [realInc] = await db
        .select()
        .from(incidents)
        .where(eq(incidents.id, realIncidentId))
        .limit(1);

      const targetStatus =
        realInc && OPEN_INCIDENT_STATUSES.includes(realInc.status) && realInc.status !== 'TRIGGERED'
          ? realInc.status
          : 'ACTIVE';

      await transition(
        shadowIncidentId,
        'ACTIVE',
        { type: 'system', id: 'scheduler' },
        'Cancel window elapsed for duplicate trigger over active duress incident',
        db
      );

      if (targetStatus !== 'ACTIVE') {
        await transition(
          shadowIncidentId,
          targetStatus,
          { type: 'system', id: 'scheduler' },
          `Synced shadow incident status with active incident ${realIncidentId}`,
          db
        );
      }

      const shadowHydrated = await getHydratedIncident(
        db,
        shadowIncidentId,
        undefined,
        { viewerRole: 'system' }
      );
      broadcastIncidentUpdate(shadowHydrated);
    } catch (err) {
      logger.warn(
        `Shadow activation failed for ${shadowIncidentId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }, safeDelay);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  activeTimers.set(shadowIncidentId, timer);
}

/**
 * Re-reads all open incidents on server startup so a server restart never
 * loses a pending activation, escalation step, or auto-expiry timer,
 * and never re-sends notifications that were already sent.
 * Auto-expiry is computed strictly from `activated_at` (expiring immediately if already past).
 */
export async function recoverPendingIncidentsOnStartup(
  dbInstance?: AppDatabase,
  overrideWindowMs?: number,
  escalationOptions?: EscalationScheduleOptions
): Promise<number> {
  const db = dbInstance || getDb();
  const openIncidents = await db
    .select()
    .from(incidents)
    .where(
      and(
        inArray(incidents.status, OPEN_INCIDENT_STATUSES),
        isNull(incidents.mergedIntoId)
      )
    );

  let scheduledCount = 0;
  for (const inc of openIncidents) {
    if (inc.status === 'TRIGGERED') {
      let windowMs = overrideWindowMs;
      if (windowMs === undefined) {
        const [owner] = await db
          .select()
          .from(users)
          .where(eq(users.id, inc.userId))
          .limit(1);
        const cancelWindowSec = owner?.cancelWindowSeconds ?? 5;
        windowMs = cancelWindowSec * 1000;
      }

      const createdMs = new Date(inc.createdAt).getTime();
      const targetMs = createdMs + windowMs;
      const remainingMs = Math.max(0, targetMs - Date.now());

      scheduleIncidentActivation(
        inc.id,
        remainingMs,
        db,
        escalationOptions
      );
      scheduledCount++;
    } else {
      const activatedMs = inc.activatedAt
        ? new Date(inc.activatedAt).getTime()
        : new Date(inc.createdAt).getTime();
      const elapsedMs = Math.max(0, Date.now() - activatedMs);

      const baseAutoExpire =
        escalationOptions?.autoExpireMs ??
        config.incidentAutoExpireMinutes * 60 * 1000;
      const remainingAutoExpireMs = baseAutoExpire - elapsedMs;

      // If auto-expiry is already past on startup, expire immediately
      if (remainingAutoExpireMs <= 0) {
        cancelScheduledEscalation(inc.id);
        await transition(
          inc.id,
          'EXPIRED',
          { type: 'system', id: 'scheduler' },
          `Incident auto-expired immediately on startup recovery (activated_at elapsed)`,
          db
        );
        const realHydrated = await getHydratedIncident(
          db,
          inc.id,
          undefined,
          { viewerRole: 'system' }
        );
        broadcastIncidentUpdate(realHydrated);
        scheduledCount++;
        continue;
      }

      if (inc.status === 'ACTIVE' || inc.status === 'NOTIFIED') {
        // Resume initial dispatch (idempotent check skips already-sent rows) and remaining escalation ladder
        await dispatchInitialActiveNotifications(
          inc.id,
          db,
          escalationOptions?.providers
        );
      }

      const baseStep1 =
        escalationOptions?.step1DelayMs ??
        config.escalationStep1DelaySeconds * 1000;
      const baseStep2 =
        escalationOptions?.step2DelayMs ??
        config.escalationStep2DelaySeconds * 1000;

      scheduleEscalationLadder(inc.id, db, {
        ...escalationOptions,
        step1DelayMs: Math.max(0, baseStep1 - elapsedMs),
        step2DelayMs: Math.max(0, baseStep2 - elapsedMs),
        autoExpireMs: remainingAutoExpireMs,
      });
      scheduledCount++;
    }
  }

  if (scheduledCount > 0) {
    logger.info(
      `Recovered ${scheduledCount} open incident(s) on startup`
    );
  }

  return scheduledCount;
}

/**
 * Schedules server-side reminder (T-minus configurable, default 3 minutes) and
 * lapse timers for an active journey so a lapse works even if the phone is offline.
 */
export function scheduleJourneyTimers(
  journey: {
    id: string;
    endsAt: string;
    status: string;
    reminderSentAt?: string | null;
  },
  dbInstance?: AppDatabase,
  options?: JourneyScheduleOptions
): void {
  const journeyId = journey.id;
  cancelScheduledJourneyTimers(journeyId);

  if (journey.status !== 'active') {
    return;
  }

  const db = dbInstance || getDb();
  const leadMs =
    options?.reminderLeadMs ??
    config.journeyReminderLeadMinutes * 60 * 1000;

  const nowMs = Date.now();
  const endsMs = new Date(journey.endsAt).getTime();
  const reminderTargetMs = endsMs - leadMs;

  // Schedule T-minus reminder if not already sent
  if (!journey.reminderSentAt) {
    const reminderDelayMs = Math.max(0, reminderTargetMs - nowMs);
    const rTimer = setTimeout(async () => {
      journeyReminderTimers.delete(journeyId);
      try {
        await sendJourneyReminderIfDue(
          journeyId,
          db,
          options?.pushProvider
        );
      } catch (err) {
        logger.warn(
          `Journey reminder timer failed for ${journeyId}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }, reminderDelayMs);
    if (typeof rTimer.unref === 'function') rTimer.unref();
    journeyReminderTimers.set(journeyId, rTimer);
  }

  // Schedule lapse timer
  const lapseDelayMs = Math.max(0, endsMs - nowMs);
  const lTimer = setTimeout(async () => {
    journeyLapseTimers.delete(journeyId);
    journeyReminderTimers.delete(journeyId);
    try {
      await lapseJourneyIfDue(journeyId, db, options?.smsProvider);
    } catch (err) {
      logger.warn(
        `Journey lapse timer failed for ${journeyId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }, lapseDelayMs);
  if (typeof lTimer.unref === 'function') lTimer.unref();
  journeyLapseTimers.set(journeyId, lTimer);
}

/**
 * Re-reads active (and un-notified lapsed) journeys on startup so timers survive
 * a server restart and never re-send an already-sent reminder or lapse notice.
 */
export async function recoverActiveJourneysOnStartup(
  dbInstance?: AppDatabase,
  options?: JourneyScheduleOptions
): Promise<number> {
  const db = dbInstance || getDb();
  const leadMs =
    options?.reminderLeadMs ??
    config.journeyReminderLeadMinutes * 60 * 1000;

  const activeRows = await db
    .select()
    .from(journeys)
    .where(inArray(journeys.status, ['active', 'lapsed']));

  let recovered = 0;
  for (const row of activeRows) {
    if (row.status === 'lapsed') {
      // If already lapsed and notified before restart, never re-send
      if (!row.lapsedNotifiedAt) {
        await lapseJourneyIfDue(row.id, db, options?.smsProvider);
        recovered++;
      }
      continue;
    }

    const nowMs = Date.now();
    const endsMs = new Date(row.endsAt).getTime();

    if (endsMs <= nowMs) {
      // Already past ends_at on startup -> lapse immediately (idempotent)
      await lapseJourneyIfDue(row.id, db, options?.smsProvider);
      recovered++;
      continue;
    }

    const reminderTargetMs = endsMs - leadMs;
    let currentReminderSentAt = row.reminderSentAt;
    if (!currentReminderSentAt && reminderTargetMs <= nowMs) {
      // Already inside the reminder window on startup and reminder not sent yet -> send once now
      await sendJourneyReminderIfDue(row.id, db, options?.pushProvider);
      currentReminderSentAt = new Date().toISOString();
    }

    scheduleJourneyTimers(
      {
        id: row.id,
        endsAt: row.endsAt,
        status: row.status,
        reminderSentAt: currentReminderSentAt,
      },
      db,
      options
    );
    recovered++;
  }

  if (recovered > 0) {
    logger.info(`Recovered ${recovered} journey(s) on startup`);
  }

  return recovered;
}
