import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { getDb, type AppDatabase } from '../core/db';
import { safetyTools, type SafetyToolRow } from '../db/schema';
import { HttpError } from './authService';

export interface SafetyToolDto {
  id: string;
  category: string;
  title: string;
  description: string;
  safe_use_notes: string;
  legal_note: string;
  link_url: string | null;
  link_label: string;
  last_checked: string;
  active: boolean;
  is_affiliate: boolean;
}

export function toSafetyToolDto(row: SafetyToolRow): SafetyToolDto {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    description: row.description,
    safe_use_notes: row.safeUseNotes,
    legal_note: row.legalNote,
    link_url: row.linkUrl,
    link_label: row.linkLabel,
    last_checked: row.lastChecked,
    active: Boolean(row.active),
    is_affiliate: Boolean(row.isAffiliate),
  };
}

export async function listSafetyTools(
  dbInstance?: AppDatabase,
  filters?: {
    category?: string;
    includeInactive?: boolean;
  }
): Promise<SafetyToolDto[]> {
  const db = dbInstance || getDb();
  const rows = await db.select().from(safetyTools);
  const catNorm = (filters?.category || '').trim().toLowerCase();

  const filtered = rows.filter((r) => {
    if (!filters?.includeInactive && !r.active) {
      return false;
    }
    if (catNorm && catNorm !== 'all' && r.category.toLowerCase() !== catNorm) {
      return false;
    }
    return true;
  });

  return filtered.map(toSafetyToolDto);
}

export async function getSafetyTool(
  dbInstance: AppDatabase | undefined,
  id: string
): Promise<SafetyToolDto> {
  const db = dbInstance || getDb();
  const [row] = await db
    .select()
    .from(safetyTools)
    .where(eq(safetyTools.id, id))
    .limit(1);

  if (!row) {
    throw new HttpError(404, 'Safety tool not found.');
  }

  return toSafetyToolDto(row);
}

export async function createSafetyToolForAdmin(
  dbInstance: AppDatabase | undefined,
  input: {
    category: string;
    title: string;
    description: string;
    safe_use_notes: string;
    legal_note: string;
    link_url?: string | null;
    link_label?: string;
    last_checked?: string;
    active?: boolean;
    is_affiliate?: boolean;
  }
): Promise<SafetyToolDto> {
  const db = dbInstance || getDb();
  const now = new Date().toISOString().slice(0, 10);
  const row: SafetyToolRow = {
    id: `tool_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
    category: input.category.trim(),
    title: input.title.trim(),
    description: input.description.trim(),
    safeUseNotes: input.safe_use_notes.trim(),
    legalNote: input.legal_note.trim(),
    linkUrl: input.link_url?.trim() || null,
    linkLabel: input.link_label?.trim() || 'Add a trusted seller link',
    lastChecked: input.last_checked?.trim() || now,
    active: input.active !== false,
    isAffiliate: Boolean(input.is_affiliate),
  };

  await db.insert(safetyTools).values(row);
  return toSafetyToolDto(row);
}

export async function updateSafetyToolForAdmin(
  dbInstance: AppDatabase | undefined,
  toolId: string,
  input: Partial<{
    category: string;
    title: string;
    description: string;
    safe_use_notes: string;
    legal_note: string;
    link_url: string | null;
    link_label: string;
    last_checked: string;
    active: boolean;
    is_affiliate: boolean;
  }>
): Promise<SafetyToolDto> {
  const db = dbInstance || getDb();
  const [existing] = await db
    .select()
    .from(safetyTools)
    .where(eq(safetyTools.id, toolId))
    .limit(1);

  if (!existing) {
    throw new HttpError(404, 'Safety tool not found.');
  }

  const patch: Partial<SafetyToolRow> = {};
  if (input.category !== undefined) patch.category = input.category.trim();
  if (input.title !== undefined) patch.title = input.title.trim();
  if (input.description !== undefined) patch.description = input.description.trim();
  if (input.safe_use_notes !== undefined) patch.safeUseNotes = input.safe_use_notes.trim();
  if (input.legal_note !== undefined) patch.legalNote = input.legal_note.trim();
  if (input.link_url !== undefined) patch.linkUrl = input.link_url?.trim() || null;
  if (input.link_label !== undefined) patch.linkLabel = input.link_label.trim();
  if (input.last_checked !== undefined) patch.lastChecked = input.last_checked.trim();
  if (input.active !== undefined) patch.active = Boolean(input.active);
  if (input.is_affiliate !== undefined) patch.isAffiliate = Boolean(input.is_affiliate);

  await db.update(safetyTools).set(patch).where(eq(safetyTools.id, toolId));

  const [updated] = await db
    .select()
    .from(safetyTools)
    .where(eq(safetyTools.id, toolId))
    .limit(1);

  return toSafetyToolDto(updated!);
}

export async function deleteSafetyToolForAdmin(
  dbInstance: AppDatabase | undefined,
  toolId: string
): Promise<{ deleted_id: string }> {
  const db = dbInstance || getDb();
  const [existing] = await db
    .select()
    .from(safetyTools)
    .where(eq(safetyTools.id, toolId))
    .limit(1);

  if (!existing) {
    throw new HttpError(404, 'Safety tool not found.');
  }

  await db.delete(safetyTools).where(eq(safetyTools.id, toolId));
  return { deleted_id: toolId };
}
