import path from 'path';
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '../db/schema';
import { config } from './config';

export type AppDatabase = LibSQLDatabase<typeof schema>;

let currentClient: Client | null = null;
let currentDb: AppDatabase | null = null;

export const MIGRATIONS_FOLDER = path.resolve(
  process.cwd(),
  'apps',
  'api',
  'src',
  'db',
  'migrations'
);

export async function initDatabase(customDatabaseUrl?: string): Promise<AppDatabase> {
  if (currentClient) {
    try {
      currentClient.close();
    } catch {
      // ignore close errors on replaced client
    }
  }

  const url = customDatabaseUrl || config.databaseUrl;
  const client = createClient({ url });
  const db = drizzle(client, { schema });

  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  currentClient = client;
  currentDb = db;
  return db;
}

export function getDb(): AppDatabase {
  if (!currentDb) {
    throw new Error('Database has not been initialized. Call initDatabase() first.');
  }
  return currentDb;
}

export async function closeDatabase(): Promise<void> {
  if (currentClient) {
    currentClient.close();
    currentClient = null;
    currentDb = null;
  }
}
