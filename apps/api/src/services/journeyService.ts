import crypto from 'crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { config } from '../core/config';
import { getDb, type AppDatabase } from '../core/db';
import { logger } from '../core/security';
import {
  journeys,
  trustedContacts,
  users,
  type JourneyRow,
  type JourneyStatus,
} from '../db/schema';
import { defaultPushProvider, type PushProvider } from '../providers/push';
import { defaultSmsProvider, type SmsProvider } from '../providers/sms';
import { HttpError } from './authService';
import { getNotifiableContacts } from './contactService';
import {
  cancelScheduledJourneyTimers,
  scheduleJourneyTimers,
  type JourneyScheduleOptions,
} from './scheduler';

export interface JourneyDto {
  id: string;
  user_id: string;
  contact_id: string | null;
  contact_name: string | null;
  started_at: string;
  ends_at: string;
  status: JourneyStatus;
  reminder_sent_at: string | null;
  lapsed_notified_at: string | null;
}

function extractFirstName(fullName: string): string {
  const trimmed = (fullName || '').trim();
  if (!trimmed) return 'SAATHI User';
  return trimmed.split(/\s+/)[0];
}

export function formatExpectedTimeHHMM(isoString: string): string {
  const d = new Date(isoString);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export async function toJourneyDto(
  db: AppDatabase,
  row: JourneyRow
): Promise<JourneyDto> {
  let contactName: string | null = null;
  if (row.contactId) {
    const [contact] = await db
      .select()
      .from(trustedContacts)
      .where(eq(trustedContacts.id, row.contactId))
      .limit(1);
    if (contact && contact.status !== 'removed') {
      contactName = contact.name;
    }
  }

  return {
    id: row.id,
    user_id: row.userId,
    contact_id: row.contactId ?? null,
    contact_name: contactName,
    started_at: row.startedAt,
    ends_at: row.endsAt,
    status: row.status,
    reminder_sent_at: row.reminderSentAt ?? null,
    lapsed_notified_at: row.lapsedNotifiedAt ?? null,
  };
}

/**
 * Starts a new Safe Journey ("Walk with me").
 * NO-TRACKING RULE: A journey collects and shares NO location by itself.
 */
export async function startJourneyForUser(
  dbInstance: AppDatabase | undefined,
  userId: string,
  input: {
    duration_minutes?: number;
    duration_seconds?: number;
    contact_id?: string | null;
    note?: string | null;
  },
  scheduleOptions?: JourneyScheduleOptions
): Promise<JourneyDto> {
  const db = dbInstance || getDb();
  let durationMs: number;
  if (input.duration_seconds !== undefined) {
    const sec = Number(input.duration_seconds);
    if (!Number.isFinite(sec) || sec <= 0 || sec > 240 * 60) {
      throw new HttpError(422, 'Invalid journey duration_seconds.');
    }
    durationMs = sec * 1000;
  } else {
    const durationMinutes = Number(input.duration_minutes);
    if (
      !Number.isFinite(durationMinutes) ||
      durationMinutes < 1 ||
      durationMinutes > 240
    ) {
      throw new HttpError(
        422,
        'Journey duration must be between 1 and 240 minutes.'
      );
    }
    durationMs = durationMinutes * 60 * 1000;
  }

  let validatedNote: string | null = null;
  if (input.note !== undefined && input.note !== null) {
    const trimmed = String(input.note).trim();
    if (trimmed.length > 100) {
      throw new HttpError(422, 'Journey note cannot exceed 100 characters.');
    }
    if (trimmed.length > 0) {
      validatedNote = trimmed;
    }
  }

  let validatedContactId: string | null = null;
  if (input.contact_id) {
    const [contact] = await db
      .select()
      .from(trustedContacts)
      .where(
        and(
          eq(trustedContacts.id, input.contact_id),
          eq(trustedContacts.userId, userId)
        )
      )
      .limit(1);

    if (!contact || contact.status !== 'accepted') {
      throw new HttpError(
        400,
        'Selected contact must be an accepted trusted contact.'
      );
    }
    validatedContactId = contact.id;
  }

  // Cancel any existing active journey for this user before starting a new one
  const existingActive = await db
    .select()
    .from(journeys)
    .where(and(eq(journeys.userId, userId), eq(journeys.status, 'active')));

  for (const prev of existingActive) {
    cancelScheduledJourneyTimers(prev.id);
    await db
      .update(journeys)
      .set({ status: 'cancelled' })
      .where(eq(journeys.id, prev.id));
  }

  const nowMs = Date.now();
  const startedAt = new Date(nowMs).toISOString();
  const endsAt = new Date(nowMs + durationMs).toISOString();

  const row: JourneyRow = {
    id: crypto.randomUUID(),
    userId,
    contactId: validatedContactId,
    note: validatedNote,
    startedAt,
    endsAt,
    status: 'active',
    reminderSentAt: null,
    lapsedNotifiedAt: null,
  };

  await db.insert(journeys).values(row);

  scheduleJourneyTimers(row, db, scheduleOptions);

  return toJourneyDto(db, row);
}

/**
 * Returns the user's current active journey (or most recent lapsed journey if still unacknowledged/active).
 * Specifically returns active journey first; if none is active, returns the latest lapsed journey if it is the most recent journey for the user so the UI can show the lapsed screen.
 */
export async function getActiveJourneyForUser(
  dbInstance: AppDatabase | undefined,
  userId: string
): Promise<JourneyDto | null> {
  const db = dbInstance || getDb();

  const [activeRow] = await db
    .select()
    .from(journeys)
    .where(and(eq(journeys.userId, userId), eq(journeys.status, 'active')))
    .orderBy(desc(journeys.startedAt))
    .limit(1);

  if (activeRow) {
    return toJourneyDto(db, activeRow);
  }

  // Check if the user's most recent journey is in 'lapsed' state so the lapsed screen can be displayed
  const [latestRow] = await db
    .select()
    .from(journeys)
    .where(eq(journeys.userId, userId))
    .orderBy(desc(journeys.startedAt))
    .limit(1);

  if (latestRow && latestRow.status === 'lapsed') {
    return toJourneyDto(db, latestRow);
  }

  return null;
}

export async function getJourneyByIdForUser(
  dbInstance: AppDatabase | undefined,
  userId: string,
  journeyId: string
): Promise<JourneyDto> {
  const db = dbInstance || getDb();
  const [row] = await db
    .select()
    .from(journeys)
    .where(and(eq(journeys.id, journeyId), eq(journeys.userId, userId)))
    .limit(1);

  if (!row) {
    throw new HttpError(404, 'Journey not found.');
  }

  return toJourneyDto(db, row);
}

/**
 * Extends an active journey by `additional_minutes` (default 10) and reschedules timers.
 */
export async function extendJourneyForUser(
  dbInstance: AppDatabase | undefined,
  userId: string,
  journeyId: string,
  additionalMinutes: number = 10,
  scheduleOptions?: JourneyScheduleOptions
): Promise<JourneyDto> {
  const db = dbInstance || getDb();
  const addMin = Number(additionalMinutes);
  if (!Number.isFinite(addMin) || addMin < 1 || addMin > 180) {
    throw new HttpError(
      422,
      'Extension must be between 1 and 180 minutes.'
    );
  }

  const [row] = await db
    .select()
    .from(journeys)
    .where(and(eq(journeys.id, journeyId), eq(journeys.userId, userId)))
    .limit(1);

  if (!row) {
    throw new HttpError(404, 'Journey not found.');
  }

  if (row.status !== 'active') {
    throw new HttpError(
      400,
      `Cannot extend a journey with status '${row.status}'.`
    );
  }

  const baseEndMs = Math.max(Date.now(), new Date(row.endsAt).getTime());
  const newEndsAt = new Date(baseEndMs + addMin * 60 * 1000).toISOString();

  // Reset reminderSentAt if new endsAt is further out than reminder lead time so she gets a reminder before the new end
  const leadMs =
    scheduleOptions?.reminderLeadMs ??
    config.journeyReminderLeadMinutes * 60 * 1000;
  const resetReminder =
    new Date(newEndsAt).getTime() - Date.now() > leadMs
      ? null
      : row.reminderSentAt;

  await db
    .update(journeys)
    .set({
      endsAt: newEndsAt,
      reminderSentAt: resetReminder,
    })
    .where(eq(journeys.id, row.id));

  const [updated] = await db
    .select()
    .from(journeys)
    .where(eq(journeys.id, row.id))
    .limit(1);

  scheduleJourneyTimers(updated!, db, scheduleOptions);

  return toJourneyDto(db, updated!);
}

/**
 * Completes a journey ("I'm safe") and stops all timers.
 * Also allows acknowledging/closing a 'lapsed' journey when the user taps "I'm safe" / dismisses.
 */
export async function completeJourneyForUser(
  dbInstance: AppDatabase | undefined,
  userId: string,
  journeyId: string
): Promise<JourneyDto> {
  const db = dbInstance || getDb();
  const [row] = await db
    .select()
    .from(journeys)
    .where(and(eq(journeys.id, journeyId), eq(journeys.userId, userId)))
    .limit(1);

  if (!row) {
    throw new HttpError(404, 'Journey not found.');
  }

  cancelScheduledJourneyTimers(row.id);

  if (row.status === 'active' || row.status === 'lapsed') {
    await db
      .update(journeys)
      .set({ status: 'completed' })
      .where(eq(journeys.id, row.id));
  } else if (row.status === 'cancelled') {
    throw new HttpError(400, 'Journey was already cancelled.');
  }

  const [updated] = await db
    .select()
    .from(journeys)
    .where(eq(journeys.id, row.id))
    .limit(1);

  return toJourneyDto(db, updated!);
}

/**
 * Cancels an active (or lapsed) journey and stops all timers.
 */
export async function cancelJourneyForUser(
  dbInstance: AppDatabase | undefined,
  userId: string,
  journeyId: string
): Promise<JourneyDto> {
  const db = dbInstance || getDb();
  const [row] = await db
    .select()
    .from(journeys)
    .where(and(eq(journeys.id, journeyId), eq(journeys.userId, userId)))
    .limit(1);

  if (!row) {
    throw new HttpError(404, 'Journey not found.');
  }

  cancelScheduledJourneyTimers(row.id);

  if (row.status === 'active' || row.status === 'lapsed') {
    await db
      .update(journeys)
      .set({ status: 'cancelled' })
      .where(eq(journeys.id, row.id));
  } else if (row.status === 'completed') {
    throw new HttpError(400, 'Journey is already completed.');
  }

  const [updated] = await db
    .select()
    .from(journeys)
    .where(eq(journeys.id, row.id))
    .limit(1);

  return toJourneyDto(db, updated!);
}

/**
 * Sends the T-minus reminder push notification to the USER via PushProvider.
 * Idempotent: never re-sends if `reminder_sent_at` is already set or journey is no longer active.
 */
export async function sendJourneyReminderIfDue(
  journeyId: string,
  dbInstance?: AppDatabase,
  pushProvider: PushProvider = defaultPushProvider
): Promise<boolean> {
  const db = dbInstance || getDb();
  const [row] = await db
    .select()
    .from(journeys)
    .where(eq(journeys.id, journeyId))
    .limit(1);

  if (!row || row.status !== 'active' || row.reminderSentAt) {
    return false;
  }

  const nowIso = new Date().toISOString();
  await db
    .update(journeys)
    .set({ reminderSentAt: nowIso })
    .where(and(eq(journeys.id, journeyId), eq(journeys.status, 'active')));

  const expectedHHMM = formatExpectedTimeHHMM(row.endsAt);

  try {
    await pushProvider.sendPush({
      recipientRef: `user:${row.userId}`,
      title: 'Check-in reminder',
      body: `Your walk check-in ends at ${expectedHHMM}. Tap "I'm safe" or extend your timer.`,
      data: {
        type: 'journey_reminder',
        journeyId: row.id,
        endsAt: row.endsAt,
      },
    });
    return true;
  } catch (err) {
    logger.warn(
      `Failed to send journey reminder push for ${journeyId}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return false;
  }
}

/**
 * Marks an active journey as `lapsed` and notifies the chosen contact ONLY if
 * `getNotifiableContacts(userId, "checkin")` returns them.
 * Plain text message (no link, no location):
 * "<first name> hasn't checked in from her walk. Expected by HH:MM."
 * Never re-sends if already lapsed/notified.
 */
export async function lapseJourneyIfDue(
  journeyId: string,
  dbInstance?: AppDatabase,
  smsProvider: SmsProvider = defaultSmsProvider
): Promise<boolean> {
  const db = dbInstance || getDb();
  const [row] = await db
    .select()
    .from(journeys)
    .where(eq(journeys.id, journeyId))
    .limit(1);

  if (!row) {
    return false;
  }

  // If already completed or cancelled, do nothing
  if (row.status === 'completed' || row.status === 'cancelled') {
    return false;
  }

  // If already lapsed and lapse notice was already processed, never duplicate
  if (row.status === 'lapsed' && row.lapsedNotifiedAt) {
    return false;
  }

  const nowIso = new Date().toISOString();
  await db
    .update(journeys)
    .set({
      status: 'lapsed',
      lapsedNotifiedAt: row.lapsedNotifiedAt || nowIso,
    })
    .where(
      and(
        eq(journeys.id, journeyId),
        inArray(journeys.status, ['active', 'lapsed'])
      )
    );

  // If already had lapsedNotifiedAt set, do not re-send
  if (row.lapsedNotifiedAt) {
    return false;
  }

  if (!row.contactId) {
    return true;
  }

  // Check eligibility via getNotifiableContacts(userId, "checkin")
  const eligibleContacts = await getNotifiableContacts(
    row.userId,
    'checkin',
    db
  );
  const chosenEligible = eligibleContacts.find((c) => c.id === row.contactId);

  if (!chosenEligible) {
    logger.info(
      `[SafeJourney] Journey ${journeyId} lapsed, but contact ${row.contactId} is not in getNotifiableContacts(userId, "checkin"); skipping SMS.`
    );
    return true;
  }

  const [owner] = await db
    .select()
    .from(users)
    .where(eq(users.id, row.userId))
    .limit(1);

  const firstName = extractFirstName(owner?.name || 'SAATHI User');
  const expectedHHMM = formatExpectedTimeHHMM(row.endsAt);

  // Plain text message (no link, no location). Optional note included ONLY here as "She said: <note>"
  const noteSuffix =
    row.note && row.note.trim().length > 0
      ? ` She said: ${row.note.trim()}`
      : '';
  const plainBody = `${firstName} hasn't checked in from her walk. Expected by ${expectedHHMM}.${noteSuffix}`;

  try {
    await smsProvider.sendSms({
      toPhoneE164: chosenEligible.phone_e164,
      body: plainBody,
      purpose: 'journey_lapse',
      metadata: {
        journeyId: row.id,
        contactId: chosenEligible.id,
      },
    });
  } catch (err) {
    logger.warn(
      `Failed to send journey lapse SMS for ${journeyId}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  return true;
}
