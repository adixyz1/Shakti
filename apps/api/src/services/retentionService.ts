import { lte } from 'drizzle-orm';
import { config } from '../core/config';
import { getDb, type AppDatabase } from '../core/db';
import { logger } from '../core/security';
import { locationSamples } from '../db/schema';

let purgeIntervalHandle: NodeJS.Timeout | null = null;

/**
 * Deletes expired location_samples whose `expires_at <= nowMs`.
 * Can be called directly in tests or run on the background schedule.
 */
export async function runLocationRetentionPurge(
  dbInstance?: AppDatabase,
  nowMs: number = Date.now()
): Promise<{ deletedCount: number }> {
  const db = dbInstance || getDb();

  const expiredRows = await db
    .select({ id: locationSamples.id })
    .from(locationSamples)
    .where(lte(locationSamples.expiresAt, nowMs));

  if (expiredRows.length === 0) {
    return { deletedCount: 0 };
  }

  await db
    .delete(locationSamples)
    .where(lte(locationSamples.expiresAt, nowMs));

  logger.info(
    `[RetentionPurge] Purged ${expiredRows.length} expired location_samples row(s)`
  );

  return { deletedCount: expiredRows.length };
}

export function startRetentionPurgeSchedule(
  dbInstance?: AppDatabase,
  intervalMs: number = config.retentionPurgeIntervalMs
): void {
  stopRetentionPurgeSchedule();

  purgeIntervalHandle = setInterval(() => {
    runLocationRetentionPurge(dbInstance).catch((err) => {
      logger.warn(
        `Retention purge job error: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    });
  }, Math.max(1000, intervalMs));

  if (typeof purgeIntervalHandle.unref === 'function') {
    purgeIntervalHandle.unref();
  }
}

export function stopRetentionPurgeSchedule(): void {
  if (purgeIntervalHandle) {
    clearInterval(purgeIntervalHandle);
    purgeIntervalHandle = null;
  }
}
