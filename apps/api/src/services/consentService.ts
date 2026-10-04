import crypto from 'crypto';
import { desc, eq } from 'drizzle-orm';
import type { AppDatabase } from '../core/db';
import {
  CONSENT_TYPES,
  consents,
  type ConsentRow,
  type ConsentType,
} from '../db/schema';
import type {
  ConsentLedgerEntryDto,
  ConsentStateMap,
  ConsentsOverviewDto,
} from '../schemas/consent';
import { logger } from '../core/security';

export function toConsentEntryDto(row: ConsentRow): ConsentLedgerEntryDto {
  return {
    id: row.id,
    user_id: row.userId,
    type: row.type,
    granted: Boolean(row.granted),
    source: row.source,
    created_at: row.createdAt,
  };
}

export function computeCurrentConsents(rowsDesc: ConsentRow[]): ConsentStateMap {
  const state: ConsentStateMap = {
    location: false,
    notifications: false,
    microphone: false,
    camera: false,
    data_processing: false,
  };

  const seen = new Set<ConsentType>();
  for (const row of rowsDesc) {
    if (!seen.has(row.type) && CONSENT_TYPES.includes(row.type)) {
      state[row.type] = Boolean(row.granted);
      seen.add(row.type);
    }
  }

  return state;
}

export async function getConsentsForUser(
  db: AppDatabase,
  userId: string
): Promise<ConsentsOverviewDto> {
  const rows = await db
    .select()
    .from(consents)
    .where(eq(consents.userId, userId))
    .orderBy(desc(consents.createdAt));

  return {
    current: computeCurrentConsents(rows),
    history: rows.map(toConsentEntryDto),
  };
}

/**
 * Append-only consent ledger writer.
 * NEVER updates or deletes existing consent rows.
 */
export async function appendConsentEntry(
  db: AppDatabase,
  params: {
    userId: string;
    type: ConsentType;
    granted: boolean;
    source: string;
  }
): Promise<{
  entry: ConsentLedgerEntryDto;
  current: ConsentStateMap;
  history: ConsentLedgerEntryDto[];
}> {
  const newRow: ConsentRow = {
    id: crypto.randomUUID(),
    userId: params.userId,
    type: params.type,
    granted: params.granted,
    source: params.source,
    createdAt: new Date().toISOString(),
  };

  await db.insert(consents).values(newRow);

  logger.info(
    `Appended consent ledger entry: type=${params.type} granted=${params.granted} source=${params.source}`
  );

  const overview = await getConsentsForUser(db, params.userId);
  return {
    entry: toConsentEntryDto(newRow),
    current: overview.current,
    history: overview.history,
  };
}
