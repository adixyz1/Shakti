import crypto from 'crypto';
import { desc, eq } from 'drizzle-orm';
import { config, isDemoModeEnabled } from '../core/config';
import { getDb, type AppDatabase } from '../core/db';
import { logger } from '../core/security';
import {
  REPORT_CATEGORIES,
  reports,
  type ReportCategory,
  type ReportRow,
} from '../db/schema';
import { HttpError } from './authService';

export function roundCoord3Decimals(coord: number): number {
  return Math.round(coord * 1000) / 1000;
}

export interface CreateReportInput {
  category: ReportCategory;
  lat: number;
  lng: number;
  note?: string | null;
  anonymous?: boolean;
}

export interface CreatedReportReceiptDto {
  id: string;
  category: ReportCategory;
  lat: number;
  lng: number;
  anonymous: boolean;
  created_at: string;
}

export interface SafetyLayerCellDto {
  cell_id: string;
  lat: number;
  lng: number;
  total_count: number;
  categories: Record<string, number>;
  last_reported_at: string;
}

export interface AdminRawReportDto {
  id: string;
  category: ReportCategory;
  lat: number;
  lng: number;
  note: string | null;
  anonymous: boolean;
  user_id: string | null;
  created_at: string;
}

/**
 * Creates a non-emergency safety report.
 * - Rounds lat/lng to 3 decimal places (~100 m grid cell).
 * - If `anonymous` is true (default), stores `user_id = NULL` and logs NO user identifier.
 */
export async function createSafetyReport(
  dbInstance: AppDatabase | undefined,
  authenticatedUserId: string | null,
  input: CreateReportInput
): Promise<CreatedReportReceiptDto> {
  const db = dbInstance || getDb();

  if (!REPORT_CATEGORIES.includes(input.category)) {
    throw new HttpError(422, 'Invalid report category.');
  }

  const latNum = Number(input.lat);
  const lngNum = Number(input.lng);
  if (
    !Number.isFinite(latNum) ||
    latNum < -90 ||
    latNum > 90 ||
    !Number.isFinite(lngNum) ||
    lngNum < -180 ||
    lngNum > 180
  ) {
    throw new HttpError(422, 'Valid latitude and longitude are required.');
  }

  let validatedNote: string | null = null;
  if (input.note !== undefined && input.note !== null) {
    const trimmed = String(input.note).trim();
    if (trimmed.length > 500) {
      throw new HttpError(422, 'Report note cannot exceed 500 characters.');
    }
    if (trimmed.length > 0) {
      validatedNote = trimmed;
    }
  }

  const isAnonymous = input.anonymous !== false;
  const roundedLat = roundCoord3Decimals(latNum);
  const roundedLng = roundCoord3Decimals(lngNum);
  const fullIso = new Date().toISOString();
  // Follow-up 2: For anonymous reports, store created_at truncated to the DATE (no time of day).
  // Non-anonymous reports keep the full timestamp.
  const createdAtValue = isAnonymous ? fullIso.slice(0, 10) : fullIso;

  // Critical privacy rule: anonymous reports must store NO user_id and logs must not link them
  const storedUserId = isAnonymous ? null : authenticatedUserId;

  const row: ReportRow = {
    id: crypto.randomUUID(),
    category: input.category,
    lat: roundedLat,
    lng: roundedLng,
    note: validatedNote,
    anonymous: isAnonymous,
    userId: storedUserId,
    isDemo: false,
    createdAt: createdAtValue,
  };

  await db.insert(reports).values(row);

  // Never log userId, phone, or exact coordinates on report submission
  logger.info(`[SafetyReport] Recorded report in category '${row.category}'`);

  return {
    id: row.id,
    category: row.category,
    lat: row.lat,
    lng: row.lng,
    anonymous: row.anonymous,
    created_at: row.createdAt,
  };
}

/**
 * GET /api/safety-layer
 * Returns aggregated counts per ~100 m grid cell (3 decimal places) and
 * ONLY cells with at least K reports (default K = config.safetyLayerMinReportsK = 5).
 * Never exposes individual report notes, IDs, or user_ids.
 */
export async function getAggregatedSafetyLayer(
  dbInstance?: AppDatabase,
  overrideMinK?: number
): Promise<{
  k_threshold: number;
  cell_precision_decimals: 3;
  approx_cell_size_meters: 110;
  cells: SafetyLayerCellDto[];
}> {
  const db = dbInstance || getDb();
  const minK = Math.max(
    1,
    overrideMinK !== undefined
      ? Number(overrideMinK)
      : config.safetyLayerMinReportsK
  );

  const allRows = await db.select().from(reports);
  const includeDemo = isDemoModeEnabled();
  const eligibleRows = allRows.filter((r) => includeDemo || !r.isDemo);

  const cellMap = new Map<
    string,
    {
      lat: number;
      lng: number;
      totalCount: number;
      categories: Record<string, number>;
      lastReportedAt: string;
    }
  >();

  for (const r of eligibleRows) {
    const gridLat = roundCoord3Decimals(r.lat);
    const gridLng = roundCoord3Decimals(r.lng);
    const cellKey = `${gridLat.toFixed(3)},${gridLng.toFixed(3)}`;

    const existing = cellMap.get(cellKey);
    if (!existing) {
      cellMap.set(cellKey, {
        lat: gridLat,
        lng: gridLng,
        totalCount: 1,
        categories: { [r.category]: 1 },
        lastReportedAt: r.createdAt,
      });
    } else {
      existing.totalCount += 1;
      existing.categories[r.category] =
        (existing.categories[r.category] || 0) + 1;
      if (r.createdAt > existing.lastReportedAt) {
        existing.lastReportedAt = r.createdAt;
      }
    }
  }

  const cells: SafetyLayerCellDto[] = [];
  for (const [cellId, bucket] of cellMap.entries()) {
    if (bucket.totalCount >= minK) {
      cells.push({
        cell_id: cellId,
        lat: bucket.lat,
        lng: bucket.lng,
        total_count: bucket.totalCount,
        categories: bucket.categories,
        last_reported_at: bucket.lastReportedAt,
      });
    }
  }

  cells.sort((a, b) => b.total_count - a.total_count);

  return {
    k_threshold: minK,
    cell_precision_decimals: 3,
    approx_cell_size_meters: 110,
    cells,
  };
}

/**
 * Admin-only raw report list for moderation.
 */
export async function listRawReportsForAdmin(
  dbInstance?: AppDatabase
): Promise<AdminRawReportDto[]> {
  const db = dbInstance || getDb();
  const rows = await db
    .select()
    .from(reports)
    .orderBy(desc(reports.createdAt));

  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    lat: r.lat,
    lng: r.lng,
    note: r.note ?? null,
    anonymous: Boolean(r.anonymous),
    user_id: r.anonymous ? null : (r.userId ?? null),
    created_at: r.createdAt,
  }));
}

/**
 * Admin-only delete a raw report by ID.
 */
export async function deleteReportForAdmin(
  dbInstance: AppDatabase | undefined,
  reportId: string
): Promise<{ deleted_id: string }> {
  const db = dbInstance || getDb();
  const [existing] = await db
    .select()
    .from(reports)
    .where(eq(reports.id, reportId))
    .limit(1);

  if (!existing) {
    throw new HttpError(404, 'Report not found.');
  }

  await db.delete(reports).where(eq(reports.id, reportId));
  return { deleted_id: reportId };
}
