import { and, isNotNull, lte } from 'drizzle-orm';
import { config } from '../core/config';
import { getDb, type AppDatabase } from '../core/db';
import { logger } from '../core/security';
import {
  contactIncidentTokens,
  contactInvitations,
  journeys,
  locationSamples,
  otpCodes,
  sentMessages,
} from '../db/schema';

let purgeIntervalHandle: NodeJS.Timeout | null = null;

export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface RetentionPurgeSummary {
  deletedCount: number;
  deletedLocationSamples: number;
  deletedContactIncidentTokens: number;
  deletedContactInvitations: number;
  clearedJourneyNotes: number;
  deletedOtpCodes: number;
  deletedSentMessages: number;
}

/**
 * Deletes/clears expired personal data on schedule (and on demand in tests):
 * 1. `location_samples` where `expires_at <= nowMs`
 * 2. `contact_incident_tokens` where `expires_at <= nowMs - 7 days`
 * 3. `contact_invitations` where `expires_at <= nowMs - 30 days`
 * 4. `journeys.note` cleared to NULL 7 days after `ends_at`
 * 5. `otp_codes` where `expires_at <= nowMs`
 * 6. `sent_messages` (dev outbox) where `created_at <= nowMs - 7 days`
 */
export async function runLocationRetentionPurge(
  dbInstance?: AppDatabase,
  nowMs: number = Date.now()
): Promise<RetentionPurgeSummary> {
  const db = dbInstance || getDb();

  // 1. Expired location_samples
  const expiredLocations = await db
    .select({ id: locationSamples.id })
    .from(locationSamples)
    .where(lte(locationSamples.expiresAt, nowMs));

  if (expiredLocations.length > 0) {
    await db
      .delete(locationSamples)
      .where(lte(locationSamples.expiresAt, nowMs));
  }

  // 2. Expired contact_incident_tokens (> 7 days after expiry)
  const tokenCutoffMs = nowMs - SEVEN_DAYS_MS;
  const expiredIncidentTokens = await db
    .select({ id: contactIncidentTokens.id })
    .from(contactIncidentTokens)
    .where(lte(contactIncidentTokens.expiresAt, tokenCutoffMs));

  if (expiredIncidentTokens.length > 0) {
    await db
      .delete(contactIncidentTokens)
      .where(lte(contactIncidentTokens.expiresAt, tokenCutoffMs));
  }

  // 3. Expired contact_invitations (> 30 days after expiry)
  const invitationCutoffMs = nowMs - THIRTY_DAYS_MS;
  const expiredInvitations = await db
    .select({ id: contactInvitations.id })
    .from(contactInvitations)
    .where(lte(contactInvitations.expiresAt, invitationCutoffMs));

  if (expiredInvitations.length > 0) {
    await db
      .delete(contactInvitations)
      .where(lte(contactInvitations.expiresAt, invitationCutoffMs));
  }

  // 4. journeys.note cleared 7 days after journey ends_at
  const sevenDaysAgoIso = new Date(nowMs - SEVEN_DAYS_MS).toISOString();
  const journeysWithOldNotes = await db
    .select({ id: journeys.id })
    .from(journeys)
    .where(
      and(isNotNull(journeys.note), lte(journeys.endsAt, sevenDaysAgoIso))
    );

  if (journeysWithOldNotes.length > 0) {
    await db
      .update(journeys)
      .set({ note: null })
      .where(
        and(isNotNull(journeys.note), lte(journeys.endsAt, sevenDaysAgoIso))
      );
  }

  // 5. Expired otp_codes
  const expiredOtps = await db
    .select({ id: otpCodes.id })
    .from(otpCodes)
    .where(lte(otpCodes.expiresAt, nowMs));

  if (expiredOtps.length > 0) {
    await db.delete(otpCodes).where(lte(otpCodes.expiresAt, nowMs));
  }

  // 6. sent_messages (dev outbox) older than 7 days
  const oldSentMessages = await db
    .select({ id: sentMessages.id })
    .from(sentMessages)
    .where(lte(sentMessages.createdAt, sevenDaysAgoIso));

  if (oldSentMessages.length > 0) {
    await db
      .delete(sentMessages)
      .where(lte(sentMessages.createdAt, sevenDaysAgoIso));
  }

  const summary: RetentionPurgeSummary = {
    deletedCount: expiredLocations.length,
    deletedLocationSamples: expiredLocations.length,
    deletedContactIncidentTokens: expiredIncidentTokens.length,
    deletedContactInvitations: expiredInvitations.length,
    clearedJourneyNotes: journeysWithOldNotes.length,
    deletedOtpCodes: expiredOtps.length,
    deletedSentMessages: oldSentMessages.length,
  };

  const totalActionCount =
    summary.deletedLocationSamples +
    summary.deletedContactIncidentTokens +
    summary.deletedContactInvitations +
    summary.clearedJourneyNotes +
    summary.deletedOtpCodes +
    summary.deletedSentMessages;

  if (totalActionCount > 0) {
    logger.info(
      `[RetentionPurge] Purged locations=${summary.deletedLocationSamples}, tokens=${summary.deletedContactIncidentTokens}, invites=${summary.deletedContactInvitations}, journeyNotes=${summary.clearedJourneyNotes}, otps=${summary.deletedOtpCodes}, outbox=${summary.deletedSentMessages}`
    );
  }

  return summary;
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
