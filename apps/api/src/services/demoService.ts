import crypto from 'crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { isDemoModeEnabled } from '../core/config';
import { getDb, type AppDatabase } from '../core/db';
import { PHASE1_SEED_ACCOUNTS, PHASE7C_SEED_RESOURCES } from '../core/seed';
import {
  consents,
  contactIncidentTokens,
  DEFAULT_ORGANIZATION_ZONE,
  incidentAccessAudit,
  incidentAssignments,
  incidentEvents,
  incidents,
  locationSamples,
  notifications,
  OPEN_INCIDENT_STATUSES,
  postIncidentRatings,
  reports,
  resources,
  responders,
  safetyPulses,
  trustedContacts,
  users,
} from '../db/schema';
import { defaultEmergencyGateway } from '../providers/emergencyGateway';
import { defaultPushProvider } from '../providers/push';
import { defaultSmsProvider } from '../providers/sms';
import { HttpError } from './authService';
import { recordIncidentAccessAudit } from './auditService';
import {
  issueContactIncidentMagicToken,
  recordContactResponseByToken,
} from './contactIncidentTokenService';
import { getNotifiableContacts } from './contactService';
import { resetPulseTracker } from './resourcePulseService';
import {
  ensureResponderProfileForUser,
  performResponderIncidentAction,
  routeActiveIncidentToResponders,
} from './responderService';
import { transition } from './incidentStateMachine';

export const DEMO_USER_PHONE = '+919000000001';
export const DEMO_RESPONDER_PHONE = '+919000000002';
export const DEMO_ADMIN_PHONE = '+919000000003';

export const DEMO_SEEDED_CONTACTS = [
  {
    id: 'demo_contact_priya_1',
    name: 'Priya Verma (Sister)',
    phoneE164: '+919000000011',
    priorityOrder: 1,
    permissions: {
      receives_sos: true,
      receives_checkin: true,
      can_see_live_location: true,
    },
    status: 'accepted' as const,
  },
  {
    id: 'demo_contact_neha_2',
    name: 'Neha Kapoor (Roommate)',
    phoneE164: '+919000000012',
    priorityOrder: 2,
    permissions: {
      receives_sos: true,
      receives_checkin: true,
      can_see_live_location: true,
    },
    status: 'accepted' as const,
  },
] as const;

export interface DemoStatusDto {
  demo_mode: true;
  banner: string;
  providers: {
    sms: { name: string; label: 'MOCK' };
    push: { name: string; label: 'MOCK' };
    gateway_112: { name: string; label: 'MOCK' };
  };
}

export function getDemoStatusDto(): DemoStatusDto {
  return {
    demo_mode: true,
    banner: 'DEMO MODE: no real alerts are sent',
    providers: {
      sms: { name: defaultSmsProvider.providerName, label: 'MOCK' },
      push: { name: defaultPushProvider.providerName, label: 'MOCK' },
      gateway_112: {
        name: defaultEmergencyGateway.providerName,
        label: 'MOCK',
      },
    },
  };
}

export interface DemoResetResultDto {
  status: 'demo_reset_complete';
  seeded: {
    users: number;
    accepted_contacts: number;
    responders: number;
    resources: number;
    demo_incidents: number;
    demo_reports: number;
    demo_safety_pulses: number;
  };
}

/**
 * Idempotently seeds or resets demo users, accepted contacts, responder,
 * resources, and demo rows (incidents, reports, safety_pulses) so every metric
 * on the analytics page passes the minimum-sample rule (MIN_SAMPLE_SIZE = 5).
 */
export async function resetAndSeedDemoData(
  dbInstance?: AppDatabase,
  options?: {
    actorAdmin?: { id: string; name: string };
    nowMs?: number;
  }
): Promise<DemoResetResultDto> {
  const db = dbInstance || getDb();
  const nowMs = options?.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // 1. Ensure baseline accounts exist and are restored to clean demo state
  const accountUserIds = new Map<string, string>();
  for (const account of PHASE1_SEED_ACCOUNTS) {
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.phoneE164, account.phoneE164))
      .limit(1);

    const orgZone = account.organizationZone || DEFAULT_ORGANIZATION_ZONE;
    if (!existing) {
      const userId = crypto.randomUUID();
      await db.insert(users).values({
        id: userId,
        phoneE164: account.phoneE164,
        name: account.name,
        role: account.role,
        language: account.language,
        organizationZone: orgZone,
        cancelWindowSeconds: 5,
        cancelPinHash: null,
        duressPinHash: null,
        createdAt: nowIso,
      });
      accountUserIds.set(account.phoneE164, userId);
    } else {
      await db
        .update(users)
        .set({
          name: account.name,
          role: account.role,
          language: account.language,
          organizationZone: orgZone,
          cancelWindowSeconds: 5,
        })
        .where(eq(users.id, existing.id));
      accountUserIds.set(account.phoneE164, existing.id);
    }
  }

  const demoUserId = accountUserIds.get(DEMO_USER_PHONE)!;
  const demoResponderUserId = accountUserIds.get(DEMO_RESPONDER_PHONE)!;

  // 2. Ensure demo user has active consents (data_processing, location, notifications)
  for (const consentType of [
    'data_processing',
    'location',
    'notifications',
  ] as const) {
    const [latest] = await db
      .select()
      .from(consents)
      .where(
        and(eq(consents.userId, demoUserId), eq(consents.type, consentType))
      )
      .orderBy(desc(consents.createdAt))
      .limit(1);

    if (!latest || !latest.granted) {
      await db.insert(consents).values({
        id: crypto.randomUUID(),
        userId: demoUserId,
        type: consentType,
        granted: true,
        source: 'demo_seed',
        createdAt: new Date(nowMs - 14 * 24 * 3600_000).toISOString(),
      });
    }
  }

  // 3. Ensure responder row exists and is active + on_duty
  const responderRow = await ensureResponderProfileForUser(
    db,
    demoResponderUserId
  );
  await db
    .update(responders)
    .set({
      organizationZone: DEFAULT_ORGANIZATION_ZONE,
      active: true,
      onDuty: true,
      updatedAt: nowIso,
    })
    .where(eq(responders.id, responderRow.id));

  // 4. Restore accepted contacts for demo user
  for (const cSeed of DEMO_SEEDED_CONTACTS) {
    const [existingById] = await db
      .select()
      .from(trustedContacts)
      .where(eq(trustedContacts.id, cSeed.id))
      .limit(1);

    if (!existingById) {
      // Also check if same phone already exists for demo user
      const [existingByPhone] = await db
        .select()
        .from(trustedContacts)
        .where(
          and(
            eq(trustedContacts.userId, demoUserId),
            eq(trustedContacts.phoneE164, cSeed.phoneE164)
          )
        )
        .limit(1);

      if (existingByPhone) {
        await db
          .update(trustedContacts)
          .set({
            name: cSeed.name,
            priorityOrder: cSeed.priorityOrder,
            permissions: cSeed.permissions,
            status: 'accepted',
            updatedAt: nowIso,
          })
          .where(eq(trustedContacts.id, existingByPhone.id));
      } else {
        await db.insert(trustedContacts).values({
          id: cSeed.id,
          userId: demoUserId,
          name: cSeed.name,
          phoneE164: cSeed.phoneE164,
          priorityOrder: cSeed.priorityOrder,
          permissions: cSeed.permissions,
          status: 'accepted',
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }
    } else {
      await db
        .update(trustedContacts)
        .set({
          userId: demoUserId,
          name: cSeed.name,
          phoneE164: cSeed.phoneE164,
          priorityOrder: cSeed.priorityOrder,
          permissions: cSeed.permissions,
          status: 'accepted',
          updatedAt: nowIso,
        })
        .where(eq(trustedContacts.id, cSeed.id));
    }
  }

  // 5. Restore baseline resources
  for (const resItem of PHASE7C_SEED_RESOURCES) {
    const [existingRes] = await db
      .select()
      .from(resources)
      .where(eq(resources.id, resItem.id))
      .limit(1);

    if (!existingRes) {
      await db.insert(resources).values({
        id: resItem.id,
        name: resItem.name,
        category: resItem.category,
        phone: resItem.phone,
        description: resItem.description,
        availableHours: resItem.availableHours,
        active: resItem.active,
      });
    } else {
      await db
        .update(resources)
        .set({
          name: resItem.name,
          category: resItem.category,
          phone: resItem.phone,
          description: resItem.description,
          availableHours: resItem.availableHours,
          active: resItem.active,
        })
        .where(eq(resources.id, resItem.id));
    }
  }

  // 6. Clean up previous is_demo rows (and any open incidents for the demo user) before re-inserting deterministic demo rows
  const allIncidents = await db.select().from(incidents);
  const demoOrUserOpenIds = allIncidents
    .filter(
      (inc) =>
        Boolean(inc.isDemo) ||
        inc.id.startsWith('demo_inc_') ||
        (inc.userId === demoUserId &&
          OPEN_INCIDENT_STATUSES.includes(inc.status))
    )
    .map((inc) => inc.id);

  if (demoOrUserOpenIds.length > 0) {
    await db
      .delete(incidentEvents)
      .where(inArray(incidentEvents.incidentId, demoOrUserOpenIds));
    await db
      .delete(locationSamples)
      .where(inArray(locationSamples.incidentId, demoOrUserOpenIds));
    await db
      .delete(notifications)
      .where(inArray(notifications.incidentId, demoOrUserOpenIds));
    await db
      .delete(incidentAssignments)
      .where(inArray(incidentAssignments.incidentId, demoOrUserOpenIds));
    await db
      .delete(contactIncidentTokens)
      .where(inArray(contactIncidentTokens.incidentId, demoOrUserOpenIds));
    await db
      .delete(postIncidentRatings)
      .where(inArray(postIncidentRatings.incidentId, demoOrUserOpenIds));
    await db
      .delete(incidentAccessAudit)
      .where(inArray(incidentAccessAudit.incidentId, demoOrUserOpenIds));
    await db
      .delete(incidents)
      .where(inArray(incidents.id, demoOrUserOpenIds));
  }

  await db.delete(reports).where(eq(reports.isDemo, true));
  await db.delete(safetyPulses).where(eq(safetyPulses.isDemo, true));
  resetPulseTracker();

  // 7. Seed 6 closed demo incidents (5 RESOLVED + 1 CANCELLED) so n >= 5 for all metrics
  const demoIncidentsBlueprint = [
    {
      id: 'demo_inc_resolved_1',
      offsetHours: 72,
      initDiffSec: 1.5,
      activeDiffSec: 5,
      ackDiffSec: 18,
      resolveDiffSec: 180,
      status: 'RESOLVED' as const,
      emergencyType: 'followed',
      rating: 5,
      lat: 28.6139,
      lng: 77.209,
      accuracyM: 12,
    },
    {
      id: 'demo_inc_resolved_2',
      offsetHours: 60,
      initDiffSec: 2.0,
      activeDiffSec: 5,
      ackDiffSec: 22,
      resolveDiffSec: 210,
      status: 'RESOLVED' as const,
      emergencyType: 'unsafe',
      rating: 4,
      lat: 28.6142,
      lng: 77.2095,
      accuracyM: 15,
    },
    {
      id: 'demo_inc_resolved_3',
      offsetHours: 48,
      initDiffSec: 1.2,
      activeDiffSec: 5,
      ackDiffSec: 15,
      resolveDiffSec: 150,
      status: 'RESOLVED' as const,
      emergencyType: 'harassment',
      rating: 5,
      lat: 28.6145,
      lng: 77.2088,
      accuracyM: 10,
    },
    {
      id: 'demo_inc_resolved_4',
      offsetHours: 36,
      initDiffSec: 2.4,
      activeDiffSec: 5,
      ackDiffSec: 25,
      resolveDiffSec: 240,
      status: 'RESOLVED' as const,
      emergencyType: 'followed',
      rating: 4,
      lat: 28.6137,
      lng: 77.2092,
      accuracyM: 14,
    },
    {
      id: 'demo_inc_resolved_5',
      offsetHours: 24,
      initDiffSec: 1.8,
      activeDiffSec: 5,
      ackDiffSec: 20,
      resolveDiffSec: 195,
      status: 'RESOLVED' as const,
      emergencyType: 'unsafe',
      rating: 5,
      lat: 28.614,
      lng: 77.2091,
      accuracyM: 11,
    },
    {
      id: 'demo_inc_cancelled_6',
      offsetHours: 12,
      initDiffSec: 1.4,
      activeDiffSec: 0,
      ackDiffSec: 0,
      resolveDiffSec: 0,
      status: 'CANCELLED' as const,
      emergencyType: null,
      rating: null,
      lat: 28.6139,
      lng: 77.209,
      accuracyM: 13,
    },
  ];

  for (const item of demoIncidentsBlueprint) {
    const createdMs = nowMs - item.offsetHours * 3600_000;
    const clientCreatedMs = createdMs - Math.round(item.initDiffSec * 1000);
    const createdIso = new Date(createdMs).toISOString();
    const clientCreatedIso = new Date(clientCreatedMs).toISOString();

    if (item.status === 'CANCELLED') {
      const cancelIso = new Date(createdMs + 3000).toISOString();
      await db.insert(incidents).values({
        id: item.id,
        userId: demoUserId,
        status: 'CANCELLED',
        emergencyType: null,
        clientRequestId: `req_${item.id}`,
        clientCreatedAt: clientCreatedIso,
        queuedOffline: false,
        createdAt: createdIso,
        activatedAt: null,
        closedAt: cancelIso,
        mergedIntoId: null,
        sourceTrigger: 'button',
        isDuress: false,
        pinAttempts: 0,
        needsUserAction: false,
        escalationStage: 0,
        isDemo: true,
      });

      await db.insert(incidentEvents).values([
        {
          id: `${item.id}_ev_1`,
          incidentId: item.id,
          fromStatus: null,
          toStatus: 'TRIGGERED',
          actorType: 'user',
          actorId: demoUserId,
          note: 'Demo SOS triggered',
          createdAt: createdIso,
        },
        {
          id: `${item.id}_ev_2`,
          incidentId: item.id,
          fromStatus: 'TRIGGERED',
          toStatus: 'CANCELLED',
          actorType: 'user',
          actorId: demoUserId,
          note: 'Demo SOS cancelled during countdown window',
          createdAt: cancelIso,
        },
      ]);
      continue;
    }

    const activeMs = createdMs + item.activeDiffSec * 1000;
    const notifiedMs = activeMs + 1000;
    const ackMs = activeMs + item.ackDiffSec * 1000;
    const respondingMs = ackMs + 15_000;
    const resolvedMs = activeMs + item.resolveDiffSec * 1000;

    const activeIso = new Date(activeMs).toISOString();
    const notifiedIso = new Date(notifiedMs).toISOString();
    const ackIso = new Date(ackMs).toISOString();
    const respondingIso = new Date(respondingMs).toISOString();
    const resolvedIso = new Date(resolvedMs).toISOString();

    await db.insert(incidents).values({
      id: item.id,
      userId: demoUserId,
      status: 'RESOLVED',
      emergencyType: item.emergencyType,
      clientRequestId: `req_${item.id}`,
      clientCreatedAt: clientCreatedIso,
      queuedOffline: false,
      createdAt: createdIso,
      activatedAt: activeIso,
      closedAt: resolvedIso,
      mergedIntoId: null,
      sourceTrigger: 'button',
      isDuress: false,
      pinAttempts: 0,
      needsUserAction: false,
      escalationStage: 0,
      isDemo: true,
    });

    // Valid state-machine chain: TRIGGERED -> ACTIVE -> NOTIFIED -> ACKNOWLEDGED -> RESPONDING -> RESOLVED
    await db.insert(incidentEvents).values([
      {
        id: `${item.id}_ev_1`,
        incidentId: item.id,
        fromStatus: null,
        toStatus: 'TRIGGERED',
        actorType: 'user',
        actorId: demoUserId,
        note: 'Demo SOS triggered',
        createdAt: createdIso,
      },
      {
        id: `${item.id}_ev_2`,
        incidentId: item.id,
        fromStatus: 'TRIGGERED',
        toStatus: 'ACTIVE',
        actorType: 'system',
        actorId: null,
        note: 'Cancel window elapsed; incident active',
        createdAt: activeIso,
      },
      {
        id: `${item.id}_ev_3`,
        incidentId: item.id,
        fromStatus: 'ACTIVE',
        toStatus: 'NOTIFIED',
        actorType: 'system',
        actorId: null,
        note: 'Trusted contacts and campus responder notified',
        createdAt: notifiedIso,
      },
      {
        id: `${item.id}_ev_4`,
        incidentId: item.id,
        fromStatus: 'NOTIFIED',
        toStatus: 'ACKNOWLEDGED',
        actorType: 'responder',
        actorId: demoResponderUserId,
        note: 'Responder Inspector Kavita Rao acknowledged incident',
        createdAt: ackIso,
      },
      {
        id: `${item.id}_ev_5`,
        incidentId: item.id,
        fromStatus: 'ACKNOWLEDGED',
        toStatus: 'RESPONDING',
        actorType: 'responder',
        actorId: demoResponderUserId,
        note: 'Responder Inspector Kavita Rao is on the way',
        createdAt: respondingIso,
      },
      {
        id: `${item.id}_ev_6`,
        incidentId: item.id,
        fromStatus: 'RESPONDING',
        toStatus: 'RESOLVED',
        actorType: 'responder',
        actorId: demoResponderUserId,
        note: 'Responder Inspector Kavita Rao resolved incident safely',
        createdAt: resolvedIso,
      },
    ]);

    await db.insert(locationSamples).values({
      id: `${item.id}_loc_1`,
      incidentId: item.id,
      lat: item.lat,
      lng: item.lng,
      accuracyM: item.accuracyM,
      capturedAt: activeIso,
      expiresAt: nowMs + 7 * 24 * 3600_000,
    });

    await db.insert(notifications).values([
      {
        id: `${item.id}_notif_sms`,
        incidentId: item.id,
        recipientType: 'contact',
        recipientRef: 'demo_contact_priya_1',
        channel: 'sms',
        status: 'delivered',
        attempts: 1,
        lastError: null,
        createdAt: notifiedIso,
      },
      {
        id: `${item.id}_notif_push`,
        incidentId: item.id,
        recipientType: 'responder',
        recipientRef: demoResponderUserId,
        channel: 'push',
        status: 'delivered',
        attempts: 1,
        lastError: null,
        createdAt: notifiedIso,
      },
      {
        id: `${item.id}_notif_gw`,
        incidentId: item.id,
        recipientType: 'gateway_112',
        recipientRef: `MOCK-112-${item.id}`,
        channel: 'gateway',
        status: 'sent',
        attempts: 1,
        lastError: null,
        createdAt: notifiedIso,
      },
    ]);

    if (item.rating !== null) {
      await db.insert(postIncidentRatings).values({
        incidentId: item.id,
        score: item.rating,
        createdAt: resolvedIso,
      });
    }
  }

  // 8. Seed 6 demo safety reports in the same ~100 m cell so the safety-layer 5-report threshold is met
  const demoReportCategories = [
    'poor_lighting',
    'poor_lighting',
    'unsafe_area',
    'broken_cctv',
    'harassment',
    'poor_lighting',
  ] as const;

  for (let i = 0; i < demoReportCategories.length; i++) {
    const reportDate = new Date(nowMs - (i + 1) * 12 * 3600_000)
      .toISOString()
      .slice(0, 10);
    await db.insert(reports).values({
      id: `demo_report_${i + 1}`,
      category: demoReportCategories[i],
      lat: 28.614,
      lng: 77.209,
      note: 'Demo safety report for campus north gate',
      anonymous: true,
      userId: null,
      createdAt: reportDate,
      isDemo: true,
    });
  }

  // 9. Seed 6 demo safety pulses across recent days so safety_pulse metric has n >= 5
  const demoPulseScores = [4, 5, 4, 3, 5, 4];
  for (let i = 0; i < demoPulseScores.length; i++) {
    const pulseDate = new Date(nowMs - i * 24 * 3600_000)
      .toISOString()
      .slice(0, 10);
    await db.insert(safetyPulses).values({
      id: `demo_pulse_${i + 1}`,
      userId: null,
      safetyScore: demoPulseScores[i],
      avoidedGoingSomewhere: i % 3 === 0,
      createdAt: pulseDate,
      isDemo: true,
    });
  }

  if (options?.actorAdmin) {
    await recordIncidentAccessAudit(db, {
      incidentId: 'demo:reset',
      actorType: 'admin',
      actorId: options.actorAdmin.id,
      actorLabel: `${options.actorAdmin.name} (simulated)`,
      action: 'simulated:demo_reset',
      detail: `[simulated] Admin ${options.actorAdmin.name} reset and re-seeded demo data`,
      nowMs,
    });
  }

  return {
    status: 'demo_reset_complete',
    seeded: {
      users: PHASE1_SEED_ACCOUNTS.length,
      accepted_contacts: DEMO_SEEDED_CONTACTS.length,
      responders: 1,
      resources: PHASE7C_SEED_RESOURCES.length,
      demo_incidents: demoIncidentsBlueprint.length,
      demo_reports: demoReportCategories.length,
      demo_safety_pulses: demoPulseScores.length,
    },
  };
}

export function canUserAccessDemoSimulation(user: {
  id: string;
  role: string;
  phoneE164: string;
}): boolean {
  if (user.role === 'admin') return true;
  if (user.phoneE164 === DEMO_USER_PHONE) return true;
  if (user.role === 'user') return true;
  return false;
}

function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveTargetOpenIncidentForSimulation(
  db: AppDatabase,
  requester: { id: string; role: string; phoneE164: string },
  explicitIncidentId?: string
) {
  if (explicitIncidentId) {
    const [inc] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, explicitIncidentId))
      .limit(1);
    if (!inc) {
      throw new HttpError(404, 'Incident not found.');
    }
    if (requester.role !== 'admin' && inc.userId !== requester.id) {
      throw new HttpError(403, 'Forbidden to simulate on another user incident.');
    }
    return inc;
  }

  const allOpen = await db
    .select()
    .from(incidents)
    .where(inArray(incidents.status, OPEN_INCIDENT_STATUSES))
    .orderBy(desc(incidents.createdAt));

  const target =
    requester.role === 'admin'
      ? allOpen.find((i) => !i.mergedIntoId)
      : allOpen.find((i) => !i.mergedIntoId && i.userId === requester.id);

  if (!target) {
    throw new HttpError(
      404,
      'No open incident found to simulate. Trigger an SOS alert first.'
    );
  }

  return target;
}

/**
 * Ensures an incident that is still in TRIGGERED (cancel countdown) transitions cleanly
 * through the state machine to ACTIVE and routes to responders before responder/contact simulation runs.
 */
async function ensureIncidentActiveForSimulation(
  db: AppDatabase,
  incidentId: string
): Promise<void> {
  const [inc] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, incidentId))
    .limit(1);
  if (!inc) {
    throw new HttpError(404, 'Incident not found.');
  }

  if (inc.status === 'TRIGGERED') {
    await transition(
      inc.id,
      'ACTIVE',
      { type: 'system', id: 'demo_simulator' },
      '[simulated] Activated incident for live demo simulation',
      db
    );
  }

  await routeActiveIncidentToResponders(inc.id, db);
}

export type SimulatedResponderAction = 'acknowledge' | 'responding' | 'resolve';

export async function simulateResponderStep(
  dbInstance: AppDatabase | undefined,
  requester: { id: string; name: string; role: string; phoneE164: string },
  input: {
    incident_id?: string;
    action: SimulatedResponderAction;
    delay_ms?: number;
    note?: string;
  }
) {
  if (!isDemoModeEnabled()) {
    throw new HttpError(404, 'Not found');
  }
  if (!canUserAccessDemoSimulation(requester)) {
    throw new HttpError(403, 'Forbidden: only admin or the demo user can run simulations.');
  }

  const db = dbInstance || getDb();
  const delayMs = Math.min(Math.max(Number(input.delay_ms ?? 150), 0), 2000);
  if (delayMs > 0) {
    await sleepMs(delayMs);
  }

  const targetIncident = await resolveTargetOpenIncidentForSimulation(
    db,
    requester,
    input.incident_id
  );

  await ensureIncidentActiveForSimulation(db, targetIncident.id);

  // Find the demo responder user (or any active responder in the zone)
  const [demoRespUser] = await db
    .select()
    .from(users)
    .where(eq(users.phoneE164, DEMO_RESPONDER_PHONE))
    .limit(1);

  if (!demoRespUser) {
    throw new HttpError(
      404,
      'Demo responder account not found. Run POST /api/demo/reset first.'
    );
  }

  await ensureResponderProfileForUser(db, demoRespUser.id);
  await routeActiveIncidentToResponders(targetIncident.id, db);

  // If action is 'resolve' and incident is still ACTIVE/NOTIFIED/ACKNOWLEDGED, ensure valid state machine path
  const [freshInc] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, targetIncident.id))
    .limit(1);

  const marker = `triggered by ${requester.role}:${requester.name || requester.id}`;

  if (
    input.action === 'resolve' &&
    freshInc &&
    (freshInc.status === 'ACTIVE' || freshInc.status === 'NOTIFIED')
  ) {
    await performResponderIncidentAction(
      db,
      demoRespUser.id,
      targetIncident.id,
      'acknowledge',
      { note: input.note },
      { simulationMarker: marker }
    );
  }

  const detail = await performResponderIncidentAction(
    db,
    demoRespUser.id,
    targetIncident.id,
    input.action,
    { note: input.note },
    { simulationMarker: marker }
  );

  return {
    simulated: true,
    actor_type: 'responder' as const,
    action: input.action,
    incident_id: detail.id,
    incident_status: detail.status,
    incident: detail,
  };
}

export type SimulatedContactAction = 'seen' | 'on_my_way';

export async function simulateContactStep(
  dbInstance: AppDatabase | undefined,
  requester: { id: string; name: string; role: string; phoneE164: string },
  input: {
    incident_id?: string;
    action: SimulatedContactAction;
    contact_id?: string;
    delay_ms?: number;
    note?: string;
  }
) {
  if (!isDemoModeEnabled()) {
    throw new HttpError(404, 'Not found');
  }
  if (!canUserAccessDemoSimulation(requester)) {
    throw new HttpError(403, 'Forbidden: only admin or the demo user can run simulations.');
  }

  const db = dbInstance || getDb();
  const delayMs = Math.min(Math.max(Number(input.delay_ms ?? 150), 0), 2000);
  if (delayMs > 0) {
    await sleepMs(delayMs);
  }

  const targetIncident = await resolveTargetOpenIncidentForSimulation(
    db,
    requester,
    input.incident_id
  );

  await ensureIncidentActiveForSimulation(db, targetIncident.id);

  // Find an eligible accepted contact for the incident owner (or create a demo accepted contact if none)
  let eligibleContacts = await getNotifiableContacts(
    targetIncident.userId,
    'sos',
    db
  );

  if (eligibleContacts.length === 0) {
    const nowIso = new Date().toISOString();
    // Ensure data_processing consent is granted for owner in demo simulation
    await db.insert(consents).values({
      id: crypto.randomUUID(),
      userId: targetIncident.userId,
      type: 'data_processing',
      granted: true,
      source: 'demo_simulate',
      createdAt: nowIso,
    });
    const fallbackContactId = `demo_sim_contact_${targetIncident.userId}`;
    const [existingContact] = await db
      .select()
      .from(trustedContacts)
      .where(eq(trustedContacts.id, fallbackContactId))
      .limit(1);
    if (!existingContact) {
      await db.insert(trustedContacts).values({
        id: fallbackContactId,
        userId: targetIncident.userId,
        name: 'Priya Verma (Demo Contact)',
        phoneE164: '+919000000011',
        priorityOrder: 1,
        permissions: {
          receives_sos: true,
          receives_checkin: true,
          can_see_live_location: true,
        },
        status: 'accepted',
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    } else {
      await db
        .update(trustedContacts)
        .set({ status: 'accepted', updatedAt: nowIso })
        .where(eq(trustedContacts.id, fallbackContactId));
    }
    eligibleContacts = await getNotifiableContacts(
      targetIncident.userId,
      'sos',
      db
    );
  }

  const chosenContact =
    (input.contact_id
      ? eligibleContacts.find((c) => c.id === input.contact_id)
      : eligibleContacts[0]) || eligibleContacts[0];

  if (!chosenContact) {
    throw new HttpError(
      400,
      'No accepted trusted contact available for this user.'
    );
  }

  // Issue a magic link token through the real token service and execute recordContactResponseByToken
  const { token } = await issueContactIncidentMagicToken(
    db,
    targetIncident.id,
    chosenContact.id
  );

  const marker = `triggered by ${requester.role}:${requester.name || requester.id}`;
  const result = await recordContactResponseByToken(
    db,
    token,
    input.action,
    input.note,
    { simulationMarker: marker }
  );

  return {
    simulated: true,
    actor_type: 'contact' as const,
    contact_id: chosenContact.id,
    contact_name: chosenContact.name,
    action: result.action,
    incident_id: targetIncident.id,
    incident_status: result.incident_status,
    summary: result.summary,
  };
}
