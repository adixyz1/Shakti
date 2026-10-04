import crypto from 'crypto';
import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from './db';
import { consents, users, type UserRole } from '../db/schema';
import { logger } from './security';

export interface SeedAccount {
  phoneE164: string;
  name: string;
  role: UserRole;
  language: 'en' | 'hi';
}

export const PHASE1_SEED_ACCOUNTS: SeedAccount[] = [
  {
    phoneE164: '+919000000001',
    name: 'Aarohi Sharma',
    role: 'user',
    language: 'en',
  },
  {
    phoneE164: '+919000000002',
    name: 'Inspector Kavita Rao',
    role: 'responder',
    language: 'en',
  },
  {
    phoneE164: '+919000000003',
    name: 'Meera Nair',
    role: 'admin',
    language: 'en',
  },
];

export async function seedDatabase(db: AppDatabase): Promise<void> {
  for (const account of PHASE1_SEED_ACCOUNTS) {
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.phoneE164, account.phoneE164))
      .limit(1);

    let userId: string;
    if (existing.length === 0) {
      userId = crypto.randomUUID();
      await db.insert(users).values({
        id: userId,
        phoneE164: account.phoneE164,
        name: account.name,
        role: account.role,
        language: account.language,
        createdAt: new Date().toISOString(),
      });
    } else {
      userId = existing[0].id;
    }

    // Seed data_processing consent for the demo user (+919000000001)
    if (account.role === 'user') {
      const existingConsent = await db
        .select()
        .from(consents)
        .where(
          and(
            eq(consents.userId, userId),
            eq(consents.type, 'data_processing')
          )
        )
        .limit(1);

      if (existingConsent.length === 0) {
        await db.insert(consents).values({
          id: crypto.randomUUID(),
          userId,
          type: 'data_processing',
          granted: true,
          source: 'seed',
          createdAt: new Date().toISOString(),
        });
      }
    }
  }
  logger.info('Seeded Phase 1 baseline accounts (user, responder, admin) and demo user data_processing consent');
}
