import fs from 'fs';
import path from 'path';
import {
  backupDatabase,
  closeDatabase,
  initDatabase,
  restoreDatabaseFromBackup,
} from '../apps/api/src/core/db';
import { config } from '../apps/api/src/core/config';

async function main() {
  const [action, targetPathArg] = process.argv.slice(2);
  const dbUrl = process.env.DATABASE_URL || config.databaseUrl;

  if (action === 'backup') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultBackupPath = path.join(
      process.cwd(),
      'backups',
      `shakti-backup-${timestamp}.db`
    );
    const outPath = targetPathArg || defaultBackupPath;

    await initDatabase(dbUrl);
    const savedPath = await backupDatabase(outPath);
    await closeDatabase();
    const stats = fs.statSync(savedPath);
    console.log(
      JSON.stringify({
        status: 'backup_complete',
        source_db: dbUrl,
        backup_file: savedPath,
        size_bytes: stats.size,
        timestamp: new Date().toISOString(),
      })
    );
    return;
  }

  if (action === 'restore') {
    if (!targetPathArg) {
      console.error(
        'Usage: npx tsx scripts/db_backup_restore.ts restore <path-to-backup.db>'
      );
      process.exit(1);
    }
    await restoreDatabaseFromBackup(targetPathArg, dbUrl);
    await closeDatabase();
    console.log(
      JSON.stringify({
        status: 'restore_complete',
        restored_from: path.resolve(process.cwd(), targetPathArg),
        target_db: dbUrl,
        timestamp: new Date().toISOString(),
      })
    );
    return;
  }

  console.log(
    'Usage:\n  npx tsx scripts/db_backup_restore.ts backup [output-file.db]\n  npx tsx scripts/db_backup_restore.ts restore <backup-file.db>'
  );
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]).endsWith('db_backup_restore.ts');
if (isMain) {
  main().catch((err) => {
    console.error('Database backup/restore error:', err);
    process.exit(1);
  });
}
