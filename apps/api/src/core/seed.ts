import crypto from 'crypto';
import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from './db';
import {
  consents,
  DEFAULT_ORGANIZATION_ZONE,
  resources,
  responders,
  safetyTools,
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

export const SAFETY_TOOLS_SEED_ITEMS = [
  {
    id: 'tool_personal_alarm_keychain',
    category: 'personal_alarm_keychain',
    title: 'Devil Will Emergency Keychain Personal Protection Alarm',
    description:
      'A battery-powered sound device attached to keys or bags that emits a high-decibel (120-130 dB) siren when the pull pin or emergency button is triggered.',
    safeUseNotes:
      'Keep it easily accessible on the outside of your bag or keys. Test battery health periodically in a sound-muffled area. Do not pull the pin directly next to ears to avoid acoustic harm.',
    legalNote:
      'Audible personal alarms are legal in public spaces in India and internationally as non-weapon personal signaling tools.',
    linkUrl:
      'https://www.amazon.in/Devil-Will-Emergency-Keychain-Protection/dp/B0BPPZFZJD/ref=mp_s_a_1_9_sspa?dib=eyJ2IjoiMSJ9.AgkpYmaW4M8wZkglFdgjcWWd37kjFeKJ02ObUhz-YuoltfN0EyTfJF07Cn8fSf7_cwTctzZi7_XMdBBboPbjTEsZCWi6rFOkzKQq6MNTNV27QNxObNiEfiBY2Y0SvePDArz6UZvHv45lUYWaT9YCySsbm_JoircgmIB0VWsCdKkKH1VLy3sORph7QvJaxzSxMNbTEuAs5kUHj9LPM2WSSA.-XNM5KroO6JesL_hiNQ3MIr0d20HgKwG724Brso4ZeI&dib_tag=se&keywords=self+defence+tools+for+men&qid=1793179756&sr=8-9-spons&aref=G8bI5MTDeF&sp_csd=d2lkZ2V0TmFtZT1zcF9waG9uZV9zZWFyY2hfbXRm&psc=1&smid=A123OED1AUH9IH',
    linkLabel: 'Devil Will Emergency Keychain Personal Protection Alarm',
    lastChecked: '2026-10-28',
    active: true,
    isAffiliate: false,
  },
  {
    id: 'tool_whistle',
    category: 'whistle',
    title: 'Safety Whistle',
    description:
      'A pealess high-frequency emergency whistle capable of producing sharp sound signals over long distances without moving parts or batteries.',
    safeUseNotes:
      'Blow with short, sharp, repeated bursts (such as the standard international distress signal of three blasts). Keep attached to a neck lanyard or bag zipper.',
    legalNote:
      'Emergency whistles are universally legal signaling and distress devices across all jurisdictions.',
    linkUrl: null,
    linkLabel: 'Add a trusted seller link',
    lastChecked: '2026-10-28',
    active: true,
    isAffiliate: false,
  },
  {
    id: 'tool_torch_keyring',
    category: 'torch_keyring',
    title: 'Eveready DL102 Rechargeable Decibels Personal Safety Alarm & Torch',
    description:
      'A rechargeable high-lumen LED flashlight with built-in high-decibel personal safety siren that illuminates dark paths and signals for help.',
    safeUseNotes:
      'Recharge batteries regularly. Use the torch mode to scan poorly lit routes, stairwells, and doorways, and trigger the siren in emergencies.',
    legalNote:
      'Standard LED flashlights and audible personal alarms are universally legal tools without carrying restrictions.',
    linkUrl:
      'https://www.amazon.in/Eveready-DL102-Rechargeable-Decibels-Personal/dp/B0D89WZ6N3/ref=sxin_31_pa_sp_phone_search_thematic_sspa?content-id=amzn1.sym.526195bb-f554-43e3-9974-2b6aa831a7a8%3Aamzn1.sym.526195bb-f554-43e3-9974-2b6aa831a7a8&cv_ct_cx=self+defence+tools+for+men&keywords=self+defence+tools+for+men&pd_rd_i=B0D89WZ6N3&pd_rd_r=5bec543d-9d2b-4370-a579-24b96d3ffa56&pd_rd_w=U7EMx&pd_rd_wg=MXs6i&pf_rd_p=526195bb-f554-43e3-9974-2b6aa831a7a8&pf_rd_r=931VB4RH1XWBKPH299TC&qid=1793179756&sr=1-2-66673dcf-083f-43ba-b782-d4a436cc5cfb-spons&aref=Kua9dENCZs&sp_csd=d2lkZ2V0TmFtZT1zcF9waG9uZV9zZWFyY2hfdGhlbWF0aWM&psc=1',
    linkLabel: 'Eveready DL102 Rechargeable Decibels Personal Safety Alarm & Torch',
    lastChecked: '2026-10-28',
    active: true,
    isAffiliate: false,
  },
  {
    id: 'tool_portable_door_alarm',
    category: 'portable_door_alarm',
    title: 'Portable Door Alarm',
    description:
      'A travel security device placed under or between a closed door and doorframe that sounds a loud siren upon detecting unauthorized door movement.',
    safeUseNotes:
      'Deploy on hotel, hostel, or temporary accommodation doors when resting. Test the sensor contact before sleeping.',
    legalNote:
      'Portable door alarms are legal security alert devices designed for private rooms and rental dwellings.',
    linkUrl: null,
    linkLabel: 'Add a trusted seller link',
    lastChecked: '2026-10-28',
    active: true,
    isAffiliate: false,
  },
  {
    id: 'tool_pepper_spray',
    category: 'pepper_spray',
    title: 'Pepper Spray for Women Safety - Self Defense Spray (55ml each, Pack of 2)',
    description:
      'A handheld pressurized canister containing pepper stream spray designed to temporarily irritate eyes and respiratory tract to facilitate escape from immediate physical danger.',
    safeUseNotes:
      'Practice deploying the safety catch with your thumb, not index finger. Be aware of wind direction to avoid self-contamination. Spray in short bursts and immediately retreat to a crowded or secure area.',
    legalNote:
      'Under Indian law (including Arms Act provisions), pepper spray carried for bona fide self-defence is lawful. However, carriage may be restricted on commercial aircraft, metro transit systems, and sensitive high-security facilities.',
    linkUrl: 'https://dl.flipkart.com/s/gawwSQuuuN',
    linkLabel: 'Pepper Spray for Women Safety - Self Defense Spray (55ml each, Pack of 2)',
    lastChecked: '2026-10-28',
    active: true,
    isAffiliate: false,
  },
  {
    id: 'tool_pepper_spray_impower_gel',
    category: 'pepper_spray',
    title: 'Impower Black Pepper Self-Defence Gel Spray (12 ft Range, Pocket Size)',
    description:
      'Pocket-size one-hand-use black pepper gel spray with a 12-foot range designed for targeted self-defence with reduced wind blowback.',
    safeUseNotes:
      'Hold firmly with thumb on the actuator. Aim toward the face and immediately move away to safety after spraying. Check expiry date periodically.',
    legalNote:
      'Under Indian law, pepper spray carried for bona fide self-defence is lawful, though restricted on flights, metro networks, and high-security premises.',
    linkUrl:
      'https://dl.flipkart.com/dl/impower-black-pepper-self-defence-spray-12-ft-range-pocket-size-one-hand-use-gel-spray/p/itm408d2cbcc02ae?pid=PSFEYDVAGWN4TNVG&lid=LSTPSFEYDVAGWN4TNVGLGEBTR&marketplace=FLIPKART&hl_lid=&store=hlc/iwt/mie&ctx=eyJkZWxpdmVyZWRCeSI6IiIsImRpc3BsYXlQcmljZSI6IjE5OSJ9&fm=eyJ3dHAiOiJwcm9kdWN0Q2FyZExpc3QiLCJwcnB0Ijoic3AiLCJtaWQiOiJBRFMifQ&_refId=&_appId=CL',
    linkLabel: 'Impower Black Pepper Self-Defence Gel Spray (12 ft Range)',
    lastChecked: '2026-10-28',
    active: true,
    isAffiliate: false,
  },
  {
    id: 'tool_self_defence_expandable_baton',
    category: 'self_defence',
    title: 'Expandable Self-Defence Baton',
    description:
      'A collapsible telescopic baton designed to create distance and deter physical assault in emergency self-defence situations.',
    safeUseNotes:
      'Maintain a firm grip and only deploy when facing imminent physical threat where retreat is blocked. Prioritize creating space to escape to safety.',
    legalNote:
      'Carriage of expandable batons in public spaces, metro/rail transit, airports, and campuses may be restricted under the Indian Arms Act and local police regulations. Verify local rules before carrying.',
    linkUrl: 'https://safetygadgets.in/products/expandable-baton',
    linkLabel: 'Expandable Self-Defence Baton',
    lastChecked: '2026-10-28',
    active: true,
    isAffiliate: false,
  },
  {
    id: 'tool_self_defence_foldable_stainless_knife',
    category: 'self_defence',
    title: 'Foldable Stainless Steel Knife',
    description:
      'Compact foldable stainless steel utility and self-defence pocket tool with a folding blade mechanism.',
    safeUseNotes:
      'Keep the blade securely folded when not in use. Handle with extreme care to prevent accidental self-injury.',
    legalNote:
      'Carrying knives in public places, public transport, metro stations, and flights is subject to strict blade-length limits and prohibitions under the Indian Arms Act and state laws. Check local regulations before purchasing or carrying.',
    linkUrl:
      'https://www.amazon.in/Foldable-Kitchen-Office-Stainless-Vegetable/dp/B0HJHG22QF/ref=mp_s_a_1_17?dib=eyJ2IjoiMSJ9.AgkpYmaW4M8wZkglFdgjcWWd37kjFeKJ02ObUhz-YuoltfN0EyTfJF07Cn8fSf7_cwTctzZi7_XMdBBboPbjTEsZCWi6rFOkzKQq6MNTNV27QNxObNiEfiBY2Y0SvePDArz6UZvHv45lUYWaT9YCySsbm_JoircgmIB0VWsCdKkKH1VLy3sORph7QvJaxzSxMNbTEuAs5kUHj9LPM2WSSA.-XNM5KroO6JesL_hiNQ3MIr0d20HgKwG724Brso4ZeI&dib_tag=se&keywords=self+defence+tools+for+men&qid=1793179756&sr=8-17',
    linkLabel: 'Foldable Stainless Steel Knife',
    lastChecked: '2026-10-28',
    active: true,
    isAffiliate: false,
  },
  {
    id: 'tool_self_defence_pocket_folding_knife_wooden',
    category: 'self_defence',
    title: 'Pocket Folding Knife with Wooden Handle',
    description:
      'Folding pocket knife with a wooden handle designed for compact storage and emergency utility or self-defence.',
    safeUseNotes:
      'Ensure the locking mechanism is fully engaged before handling and keep safely closed when stored.',
    legalNote:
      'Carrying folding knives is restricted on flights, metro networks, campuses, and under local police notifications and the Indian Arms Act. Verify local laws before buying or carrying.',
    linkUrl:
      'https://www.amazon.in/Pocket-Folding-Knife-Wooden-Handle/dp/B0HJZJHTP6/ref=mp_s_a_1_12?dib=eyJ2IjoiMSJ9.AgkpYmaW4M8wZkglFdgjcWWd37kjFeKJ02ObUhz-YuoltfN0EyTfJF07Cn8fSf7_cwTctzZi7_XMdBBboPbjTEsZCWi6rFOkzKQq6MNTNV27QNxObNiEfiBY2Y0SvePDArz6UZvHv45lUYWaT9YCySsbm_JoircgmIB0VWsCdKkKH1VLy3sORph7QvJaxzSxMNbTEuAs5kUHj9LPM2WSSA.-XNM5KroO6JesL_hiNQ3MIr0d20HgKwG724Brso4ZeI&dib_tag=se&keywords=self+defence+tools+for+men&qid=1793179756&sr=8-12',
    linkLabel: 'Pocket Folding Knife with Wooden Handle',
    lastChecked: '2026-10-28',
    active: true,
    isAffiliate: false,
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

  for (const toolItem of SAFETY_TOOLS_SEED_ITEMS) {
    const existingTool = await db
      .select()
      .from(safetyTools)
      .where(eq(safetyTools.id, toolItem.id))
      .limit(1);

    if (existingTool.length === 0) {
      await db.insert(safetyTools).values({
        id: toolItem.id,
        category: toolItem.category,
        title: toolItem.title,
        description: toolItem.description,
        safeUseNotes: toolItem.safeUseNotes,
        legalNote: toolItem.legalNote,
        linkUrl: toolItem.linkUrl,
        linkLabel: toolItem.linkLabel,
        lastChecked: toolItem.lastChecked,
        active: toolItem.active,
        isAffiliate: toolItem.isAffiliate,
      });
    } else if (!existingTool[0].linkUrl && toolItem.linkUrl) {
      await db
        .update(safetyTools)
        .set({
          title: toolItem.title,
          description: toolItem.description,
          safeUseNotes: toolItem.safeUseNotes,
          legalNote: toolItem.legalNote,
          linkUrl: toolItem.linkUrl,
          linkLabel: toolItem.linkLabel,
          lastChecked: toolItem.lastChecked,
        })
        .where(eq(safetyTools.id, toolItem.id));
    }
  }

  // Only seed rich demo scenario data when specifically running the demo server/route, not in unit/integration test suites
  const isVitest = Boolean(process.env.VITEST || process.env.NODE_ENV === 'test');
  if (isDemoModeEnabled() && !isVitest) {
    await resetAndSeedDemoData(db);
  }

  logger.info(
    'Seeded Phase 1 baseline accounts (user, responder, admin), demo user data_processing consent, demo responder profile, Phase 7C resources directory, and safety tools guide'
  );
}
