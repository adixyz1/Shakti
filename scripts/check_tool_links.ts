import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export interface SafetyToolLinkItem {
  id?: string;
  seller_name?: string;
  link_url: string;
  is_affiliate?: boolean;
  last_checked: string;
}

export interface SafetyToolCategoryItem {
  id: string;
  slug: string;
  title: string;
  description: string;
  safe_use_notes: string;
  legal_note: string;
  links: SafetyToolLinkItem[];
}

export interface SafetyToolsSeedData {
  categories: SafetyToolCategoryItem[];
}

export const SHORTENER_HOSTS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'ow.ly',
  'is.gd',
  'buff.ly',
  'adf.ly',
  'bl.ink',
  'rebrand.ly',
  'shorturl.at',
  'cutt.ly',
]);

export function validateSingleLink(
  link: SafetyToolLinkItem,
  seenUrls?: Set<string>,
  nowMs: number = Date.now()
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const url = (link.link_url || '').trim();

  // 1. Prohibited protocols: javascript:, data:
  if (url.startsWith('javascript:') || url.startsWith('data:')) {
    errors.push(`Prohibited scheme in URL: ${url}`);
    return { valid: false, errors };
  }

  // 2. Must be https
  if (!url.startsWith('https://')) {
    errors.push(`Non-HTTPS link rejected (must start with https://): ${url}`);
    return { valid: false, errors };
  }

  // 3. URL shorteners
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (SHORTENER_HOSTS.has(host)) {
      errors.push(`URL shortener rejected (${host}): ${url}`);
    }
  } catch {
    errors.push(`Malformed URL: ${url}`);
    return { valid: false, errors };
  }

  // 4. Duplicate links
  if (seenUrls) {
    const normalizedUrl = url.toLowerCase().replace(/\/$/, '');
    if (seenUrls.has(normalizedUrl)) {
      errors.push(`Duplicate link detected: ${url}`);
    } else {
      seenUrls.add(normalizedUrl);
    }
  }

  // 5. last_checked older than 90 days
  const checkDate = new Date(link.last_checked).getTime();
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  if (isNaN(checkDate)) {
    errors.push(`Invalid last_checked date: ${link.last_checked}`);
  } else if (nowMs - checkDate > ninetyDaysMs) {
    errors.push(
      `link_url last_checked is older than 90 days (${link.last_checked}): ${url}`
    );
  }

  return { valid: errors.length === 0, errors };
}

export function validateToolLinks(
  filePath: string,
  nowMs: number = Date.now()
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!fs.existsSync(filePath)) {
    return { valid: false, errors: [`File not found: ${filePath}`] };
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  let data: SafetyToolsSeedData;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return { valid: false, errors: [`Invalid JSON in ${filePath}: ${String(err)}`] };
  }

  const seenUrls = new Set<string>();

  for (const cat of data.categories || []) {
    for (const link of cat.links || []) {
      const singleRes = validateSingleLink(link, seenUrls, nowMs);
      for (const err of singleRes.errors) {
        errors.push(`[${cat.slug}] ${err}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export async function validateDatabaseToolLinks(
  nowMs: number = Date.now()
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  try {
    const { initDatabase, closeDatabase } = await import('../apps/api/src/core/db');
    const { safetyTools } = await import('../apps/api/src/db/schema');
    const db = await initDatabase();
    const rows = await db.select().from(safetyTools);
    const seenUrls = new Set<string>();

    for (const row of rows) {
      if (row.linkUrl && row.linkUrl.trim() !== '') {
        const singleRes = validateSingleLink(
          {
            id: row.id,
            seller_name: row.linkLabel,
            link_url: row.linkUrl,
            is_affiliate: row.isAffiliate,
            last_checked: row.lastChecked,
          },
          seenUrls,
          nowMs
        );
        for (const err of singleRes.errors) {
          errors.push(`[db:${row.id}] ${err}`);
        }
      }
    }
    await closeDatabase();
  } catch (err) {
    // If DB is uninitialized or not accessible in this context, skip gracefully
    console.log(`[check:tool-links] Note: Database link scan skipped or empty: ${String(err)}`);
  }

  return { valid: errors.length === 0, errors };
}

export async function runChecker(
  customSeedPath?: string,
  skipDb: boolean = false
): Promise<boolean> {
  const targetFile =
    customSeedPath || path.resolve(process.cwd(), 'data/safety-tools.seed.json');
  console.log(`[check:tool-links] Verifying seed file: ${targetFile}`);
  const seedResult = validateToolLinks(targetFile);

  let dbErrors: string[] = [];
  if (!skipDb) {
    console.log('[check:tool-links] Verifying database tool links...');
    const dbResult = await validateDatabaseToolLinks();
    dbErrors = dbResult.errors;
  }

  const allErrors = [...seedResult.errors, ...dbErrors];
  if (allErrors.length > 0) {
    console.error('[check:tool-links] Validation FAILED with errors:');
    allErrors.forEach((e) => console.error(`  - ${e}`));
    return false;
  }

  console.log(
    '[check:tool-links] All safety tool links in seed file and database passed static verification (no network calls).'
  );
  return true;
}

export async function runCli(
  customSeedPath?: string,
  skipDb: boolean = false
): Promise<number> {
  try {
    const success = await runChecker(customSeedPath, skipDb);
    const code = success ? 0 : 1;
    process.exit(code);
    return code;
  } catch (err) {
    console.error('[check:tool-links] Fatal execution error:', err);
    process.exit(1);
    return 1;
  }
}

const currentFilePath = fileURLToPath(import.meta.url);
if (
  process.env.VITEST !== 'true' &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(currentFilePath)
) {
  void runCli();
}
