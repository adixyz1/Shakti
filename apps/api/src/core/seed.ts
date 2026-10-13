import crypto from 'crypto';
import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from './db';
import {
  consents,
  DEFAULT_ORGANIZATION_ZONE,
  resources,
  responders,
  users,
  type UserRole,
} from '../db/schema';
import { logger } from './security';
import { isDemoModeEnabled } from './config';
import { resetAndSeedDemoData } from '../services/demoService';

export interface SeedAccount {
  phoneE164: string;
  name: string;
  role: UserRole;
  language: 'en' | 'hi';
  organizationZone?: string;
}

export const PHASE1_SEED_ACCOUNTS: SeedAccount[] = [
  {
    phoneE164: '+919000000001',
    name: 'Aarohi Sharma',
    role: 'user',
    language: 'en',
    organizationZone: DEFAULT_ORGANIZATION_ZONE,
  },
  {
    phoneE164: '+919000000002',
    name: 'Inspector Kavita Rao',
    role: 'responder',
    language: 'en',
    organizationZone: DEFAULT_ORGANIZATION_ZONE,
  },
  {
    phoneE164: '+919000000003',
    name: 'Meera Nair',
    role: 'admin',
    language: 'en',
    organizationZone: DEFAULT_ORGANIZATION_ZONE,
  },
];

export const PHASE7C_SEED_RESOURCES = [
  {
    id: 'res_112_erss',
    name: '112 Emergency Response Support System (ERSS)',
    category: 'emergency_helpline',
    phone: '112',
    description:
      'National pan-India emergency response number for police, fire, and medical assistance.',
    availableHours: '24x7',
    active: true,
  },
  {
    id: 'res_181_women_helpline',
    name: '181 Women Helpline',
    category: 'women_helpline',
    phone: '181',
    description:
      'Toll-free 24-hour telecom helpline for women seeking support, crisis intervention, and referral.',
    availableHours: '24x7',
    active: true,
  },
  {
    id: 'res_one_stop_centre',
    name: 'Sakhi One Stop Centre (OSC)',
    category: 'one_stop_centre',
    phone: 'add your local number (or dial 181 for nearest OSC)',
    description:
      'Integrated support and assistance under one roof (medical, legal, psychological, and temporary shelter). Placeholder: add your local district OSC number.',
    availableHours: '24x7',
    active: true,
  },
  {
    id: 'res_campus_security',
    name: 'Campus Security Control Desk (Editable Placeholder)',
    category: 'campus_security',
    phone: 'add your local number',
    description:
      'Campus or workplace security control room. Editable placeholder — admin should configure your institution desk number.',
    availableHours: '24x7',
    active: true,
  },
  {
    id: 'res_legal_aid',
    name: 'District Legal Services Authority (DLSA / Legal Aid)',
    category: 'legal_aid',
    phone: 'add your local number',
    description:
      'Free legal aid and rights counseling for women. Placeholder: add your local number.',
    availableHours: 'Mon-Sat 10:00-17:00 (add your local number)',
    active: true,
  },
  {
    id: 'res_counseling',
    name: 'Psychosocial & Trauma Counseling Support',
    category: 'counseling',
    phone: 'add your local number',
    description:
      'Confidential emotional and trauma counseling service. Placeholder: add your local number.',
    availableHours: 'Mon-Sat 09:00-18:00 (add your local number)',
    active: true,
  },
] as const;

export async function seedDatabase(
  db: AppDatabase,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const nowIso = new Date().toISOString();
  const nodeEnv = (env.NODE_ENV || env.ENVIRONMENT || 'development').trim();
  const shouldSeedAccounts =
    isDemoModeEnabled() || nodeEnv !== 'production';

  if (shouldSeedAccounts) {
    for (const account of PHASE1_SEED_ACCOUNTS) {
      const existing = await db
        .select()
        .from(users)
        .where(eq(users.phoneE164, account.phoneE164))
        .limit(1);

      let userId: string;
      const orgZone = account.organizationZone || DEFAULT_ORGANIZATION_ZONE;
      if (existing.length === 0) {
        userId = crypto.randomUUID();
        await db.insert(users).values({
          id: userId,
          phoneE164: account.phoneE164,
          name: account.name,
          role: account.role,
          language: account.language,
          organizationZone: orgZone,
          createdAt: nowIso,
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
            createdAt: nowIso,
          });
        }
      }

      // Seed responder profile for the demo responder account (+919000000002)
      if (account.role === 'responder') {
        const existingResponder = await db
          .select()
          .from(responders)
          .where(eq(responders.userId, userId))
          .limit(1);

        if (existingResponder.length === 0) {
          await db.insert(responders).values({
            id: crypto.randomUUID(),
            userId,
            organizationZone: orgZone,
            active: true,
            onDuty: true,
            createdAt: nowIso,
            updatedAt: nowIso,
          });
        }
      }
    }
  }

  for (const resItem of PHASE7C_SEED_RESOURCES) {
    const existingRes = await db
      .select()
      .from(resources)
      .where(eq(resources.id, resItem.id))
      .limit(1);

    if (existingRes.length === 0) {
      await db.insert(resources).values({
        id: resItem.id,
        name: resItem.name,
        category: resItem.category,
        phone: resItem.phone,
        description: resItem.description,
        availableHours: resItem.availableHours,
        active: resItem.active,
      });
    }
  }

  if (isDemoModeEnabled()) {
    await resetAndSeedDemoData(db);
  }

  logger.info(
    'Seeded Phase 1 baseline accounts (user, responder, admin), demo user data_processing consent, demo responder profile, and Phase 7C resources directory'
  );
}
