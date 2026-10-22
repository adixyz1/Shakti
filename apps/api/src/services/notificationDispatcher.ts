import crypto from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { config } from '../core/config';
import { getDb, type AppDatabase } from '../core/db';
import { logger } from '../core/security';
import {
  consents,
  incidents,
  locationSamples,
  notifications,
  users,
  type NotificationChannel,
  type NotificationRecipientType,
  type NotificationRow,
} from '../db/schema';
import {
  defaultEmergencyGateway,
  type EmergencyServiceGateway,
} from '../providers/emergencyGateway';
import { defaultPushProvider, type PushProvider } from '../providers/push';
import { defaultSmsProvider, type SmsProvider } from '../providers/sms';
import type { TrustedContactDto } from '../schemas/contact';
import { getNotifiableContacts } from './contactService';
import { issueContactIncidentMagicToken } from './contactIncidentTokenService';
import { getHydratedIncident } from './incidentService';
import { transition } from './incidentStateMachine';
import { routeActiveIncidentToResponders } from './responderService';
import { broadcastIncidentUpdate } from './wsHub';

export interface NotificationProviders {
  pushProvider?: PushProvider;
  smsProvider?: SmsProvider;
  emergencyGateway?: EmergencyServiceGateway;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function hasActiveLocationConsent(
  db: AppDatabase,
  userId: string
): Promise<boolean> {
  const rows = await db
    .select()
    .from(consents)
    .where(and(eq(consents.userId, userId), eq(consents.type, 'location')))
    .orderBy(desc(consents.createdAt))
    .limit(1);

  if (rows.length === 0) {
    return false;
  }
  return Boolean(rows[0].granted);
}

async function getLatestLocationSample(db: AppDatabase, incidentId: string) {
  const [sample] = await db
    .select()
    .from(locationSamples)
    .where(eq(locationSamples.incidentId, incidentId))
    .orderBy(desc(locationSamples.capturedAt))
    .limit(1);
  return sample || null;
}

async function alreadyDispatchedChannel(
  db: AppDatabase,
  incidentId: string,
  recipientType: NotificationRecipientType,
  recipientRef: string,
  channel: NotificationChannel
): Promise<boolean> {
  const existing = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.incidentId, incidentId),
        eq(notifications.recipientType, recipientType),
        eq(notifications.recipientRef, recipientRef),
        eq(notifications.channel, channel)
      )
    )
    .limit(1);

  return existing.length > 0;
}

async function dispatchWithRetry(
  db: AppDatabase,
  params: {
    incidentId: string;
    recipientType: NotificationRecipientType;
    recipientRef: string;
    channel: NotificationChannel;
    maxAttempts?: number;
    baseDelayMs?: number;
    sendFn: () => Promise<void>;
  }
): Promise<NotificationRow> {
  const maxAttempts = params.maxAttempts ?? config.notificationMaxAttempts;
  const baseDelayMs = params.baseDelayMs ?? config.notificationRetryBaseDelayMs;
  const notifId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await db.insert(notifications).values({
    id: notifId,
    incidentId: params.incidentId,
    recipientType: params.recipientType,
    recipientRef: params.recipientRef,
    channel: params.channel,
    status: 'queued',
    attempts: 0,
    lastError: null,
    createdAt,
  });

  let attempts = 0;
  let lastError: string | null = null;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      await params.sendFn();
      await db
        .update(notifications)
        .set({
          status: 'sent',
          attempts,
          lastError: null,
        })
        .where(eq(notifications.id, notifId));

      return {
        id: notifId,
        incidentId: params.incidentId,
        recipientType: params.recipientType,
        recipientRef: params.recipientRef,
        channel: params.channel,
        status: 'sent',
        attempts,
        lastError: null,
        createdAt,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await db
        .update(notifications)
        .set({
          status: 'failed',
          attempts,
          lastError,
        })
        .where(eq(notifications.id, notifId));

      if (attempts < maxAttempts && baseDelayMs > 0) {
        await sleep(baseDelayMs * Math.pow(2, attempts - 1));
      }
    }
  }

  logger.warn(
    `Notification delivery failed after ${attempts} attempts (incident=${params.incidentId}, channel=${params.channel}): ${lastError}`
  );

  return {
    id: notifId,
    incidentId: params.incidentId,
    recipientType: params.recipientType,
    recipientRef: params.recipientRef,
    channel: params.channel,
    status: 'failed',
    attempts,
    lastError,
    createdAt,
  };
}

/**
 * Notifies a slice of eligible contacts (in priority order) via Push and SMS independently.
 * If at least one notification is handed to a provider (`status === 'sent'`) and the incident
 * is currently `ACTIVE`, transitions the incident `ACTIVE -> NOTIFIED`.
 */
export async function dispatchToEligibleContacts(
  incidentId: string,
  targetContacts: TrustedContactDto[],
  dbInstance?: AppDatabase,
  providers?: NotificationProviders
): Promise<{ sentCount: number; failedCount: number }> {
  const db = dbInstance || getDb();
  const pushProvider = providers?.pushProvider || defaultPushProvider;
  const smsProvider = providers?.smsProvider || defaultSmsProvider;

  const [inc] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, incidentId))
    .limit(1);

  if (!inc) {
    return { sentCount: 0, failedCount: 0 };
  }

  const [owner] = await db
    .select()
    .from(users)
    .where(eq(users.id, inc.userId))
    .limit(1);

  const ownerName = owner?.name || 'SAATHI User';
  const userLocationConsent = await hasActiveLocationConsent(db, inc.userId);
  const latestSample = userLocationConsent
    ? await getLatestLocationSample(db, incidentId)
    : null;

  // Also check which contacts specifically have can_see_live_location permission
  const liveLocationEligibleIds = new Set(
    (await getNotifiableContacts(inc.userId, 'live_location', db)).map(
      (c) => c.id
    )
  );

  let sentCount = 0;
  let failedCount = 0;

  for (const contact of targetContacts) {
    const canIncludeCoords =
      userLocationConsent &&
      Boolean(latestSample) &&
      liveLocationEligibleIds.has(contact.id);

    const coordsText =
      canIncludeCoords && latestSample
        ? ` Location: ${latestSample.lat.toFixed(5)}, ${latestSample.lng.toFixed(5)}.`
        : '';

    const magicLink = await issueContactIncidentMagicToken(
      db,
      incidentId,
      contact.id
    );

    const messageTitle = `SHAKTI SOS Alert: ${ownerName}`;
    const messageBody = `URGENT: ${ownerName} triggered an emergency SOS alert on SHAKTI.${coordsText} Respond immediately: ${magicLink.urlPath} or dial 112/181 if needed.`;

    // 1. Push channel (independent)
    const pushAlreadySent = await alreadyDispatchedChannel(
      db,
      incidentId,
      'contact',
      contact.id,
      'push'
    );
    if (!pushAlreadySent) {
      const pushRow = await dispatchWithRetry(db, {
        incidentId,
        recipientType: 'contact',
        recipientRef: contact.id,
        channel: 'push',
        sendFn: () =>
          pushProvider.sendPush({
            recipientRef: contact.id,
            title: messageTitle,
            body: messageBody,
            data: {
              incident_id: incidentId,
              contact_url: magicLink.urlPath,
              ...(canIncludeCoords && latestSample
                ? { lat: latestSample.lat, lng: latestSample.lng }
                : {}),
            },
          }),
      });
      if (pushRow.status === 'sent') sentCount++;
      else failedCount++;
    }

    // 2. SMS channel (independent)
    const smsAlreadySent = await alreadyDispatchedChannel(
      db,
      incidentId,
      'contact',
      contact.id,
      'sms'
    );
    if (!smsAlreadySent) {
      const smsRow = await dispatchWithRetry(db, {
        incidentId,
        recipientType: 'contact',
        recipientRef: contact.id,
        channel: 'sms',
        sendFn: () =>
          smsProvider.sendSms({
            toPhoneE164: contact.phone_e164,
            body: messageBody,
            purpose: 'sos_alert',
            metadata: {
              incident_id: incidentId,
              contact_id: contact.id,
              contact_name: contact.name,
              contact_url: magicLink.urlPath,
              token: magicLink.token,
              expires_at: new Date(magicLink.expiresAt).toISOString(),
              ...(canIncludeCoords && latestSample
                ? { lat: latestSample.lat, lng: latestSample.lng }
                : {}),
            },
          }),
      });
      if (smsRow.status === 'sent') sentCount++;
      else failedCount++;
    }
  }

  // Re-read current incident status; if ACTIVE and at least one notification was sent, transition ACTIVE -> NOTIFIED
  const [freshInc] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, incidentId))
    .limit(1);

  if (freshInc && freshInc.status === 'ACTIVE' && sentCount > 0) {
    await transition(
      incidentId,
      'NOTIFIED',
      { type: 'system', id: 'dispatcher' },
      `At least one notification handed to provider (${sentCount} sent)`,
      db
    );
  }

  const realHydrated = await getHydratedIncident(db, incidentId, undefined, {
    viewerRole: 'system',
  });
  broadcastIncidentUpdate(realHydrated);

  return { sentCount, failedCount };
}

/**
 * Step 0 (t=0 on ACTIVE):
 * 1. Route incident to all active, on-duty responders in the user's organization_zone and notify them via PushProvider (mock) when data_processing consent is active.
 * 2. Notify priority #1 eligible contact from getNotifiableContacts(userId, 'sos').
 */
export async function dispatchInitialActiveNotifications(
  incidentId: string,
  dbInstance?: AppDatabase,
  providers?: NotificationProviders
): Promise<{ sentCount: number; failedCount: number }> {
  const db = dbInstance || getDb();
  const pushProvider = providers?.pushProvider || defaultPushProvider;

  const [inc] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, incidentId))
    .limit(1);

  if (!inc) {
    return { sentCount: 0, failedCount: 0 };
  }

  // Respect data_processing consent before routing/notifying responders or contacts
  const dpConsentRows = await db
    .select()
    .from(consents)
    .where(
      and(
        eq(consents.userId, inc.userId),
        eq(consents.type, 'data_processing')
      )
    )
    .orderBy(desc(consents.createdAt))
    .limit(1);

  const hasDataProcessingConsent =
    dpConsentRows.length > 0 && Boolean(dpConsentRows[0].granted);

  if (!hasDataProcessingConsent) {
    return { sentCount: 0, failedCount: 0 };
  }

  // Route incident to all active, on-duty responders of the user's organization_zone
  const assignments = await routeActiveIncidentToResponders(
    incidentId,
    db
  );

  const [owner] = await db
    .select()
    .from(users)
    .where(eq(users.id, inc.userId))
    .limit(1);
  const ownerFirstName = (owner?.name || 'SAATHI User').trim().split(/\s+/)[0];

  let responderSentCount = 0;
  let responderFailedCount = 0;

  for (const assign of assignments) {
    const alreadySentPush = await alreadyDispatchedChannel(
      db,
      incidentId,
      'responder',
      assign.responderUserId,
      'push'
    );
    if (!alreadySentPush) {
      const pushRow = await dispatchWithRetry(db, {
        incidentId,
        recipientType: 'responder',
        recipientRef: assign.responderUserId,
        channel: 'push',
        sendFn: () =>
          pushProvider.sendPush({
            recipientRef: assign.responderUserId,
            title: `SHAKTI Responder Dispatch (${assign.organizationZone})`,
            body: `Active SOS alert in ${assign.organizationZone} (${ownerFirstName}). Open Responder Dashboard immediately.`,
            data: {
              incident_id: incidentId,
              organization_zone: assign.organizationZone,
              responder_id: assign.responderId,
            },
          }),
      });
      if (pushRow.status === 'sent') responderSentCount++;
      else responderFailedCount++;
    }
  }

  const eligibleContacts = await getNotifiableContacts(inc.userId, 'sos', db);
  const firstContactSlice = eligibleContacts.slice(0, 1);

  const contactCounts = await dispatchToEligibleContacts(
    incidentId,
    firstContactSlice,
    db,
    providers
  );

  const totalSent = responderSentCount + contactCounts.sentCount;
  const totalFailed = responderFailedCount + contactCounts.failedCount;

  // Broadcast updated incident (with responder notification rows) to WS subscribers
  if (responderSentCount > 0 || responderFailedCount > 0) {
    const realHydrated = await getHydratedIncident(db, incidentId, undefined, {
      viewerRole: 'system',
    });
    broadcastIncidentUpdate(realHydrated);
  }

  return { sentCount: totalSent, failedCount: totalFailed };
}

/**
 * Step 1 (t=N seconds with no acknowledgement): Notify remaining eligible contacts (2..5).
 */
export async function dispatchSecondaryEscalationNotifications(
  incidentId: string,
  dbInstance?: AppDatabase,
  providers?: NotificationProviders
): Promise<{ sentCount: number; failedCount: number }> {
  const db = dbInstance || getDb();
  const [inc] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, incidentId))
    .limit(1);

  if (!inc) {
    return { sentCount: 0, failedCount: 0 };
  }

  const eligibleContacts = await getNotifiableContacts(inc.userId, 'sos', db);
  const remainingContacts = eligibleContacts.slice(1);

  await db
    .update(incidents)
    .set({ escalationStage: Math.max(inc.escalationStage, 1) })
    .where(eq(incidents.id, incidentId));

  return dispatchToEligibleContacts(
    incidentId,
    remainingContacts,
    db,
    providers
  );
}

/**
 * Step 2 (t=M seconds with still no acknowledgement): Set needs_user_action = true
 * and send the MockEmergencyGateway (112) request.
 */
export async function dispatchFinalGatewayEscalation(
  incidentId: string,
  dbInstance?: AppDatabase,
  providers?: NotificationProviders
): Promise<{ gatewaySent: boolean }> {
  const db = dbInstance || getDb();
  const emergencyGateway =
    providers?.emergencyGateway || defaultEmergencyGateway;

  const [inc] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, incidentId))
    .limit(1);

  if (!inc) {
    return { gatewaySent: false };
  }

  await db
    .update(incidents)
    .set({
      needsUserAction: true,
      escalationStage: Math.max(inc.escalationStage, 2),
    })
    .where(eq(incidents.id, incidentId));

  const userLocationConsent = await hasActiveLocationConsent(db, inc.userId);
  const latestSample = userLocationConsent
    ? await getLatestLocationSample(db, incidentId)
    : null;

  const alreadySentGateway = await alreadyDispatchedChannel(
    db,
    incidentId,
    'gateway_112',
    '112_erss',
    'gateway'
  );

  let gatewaySent = false;
  if (!alreadySentGateway) {
    const gwRow = await dispatchWithRetry(db, {
      incidentId,
      recipientType: 'gateway_112',
      recipientRef: '112_erss',
      channel: 'gateway',
      sendFn: async () => {
        await emergencyGateway.dispatch112({
          incidentId,
          userId: inc.userId,
          emergencyType: inc.emergencyType,
          location: latestSample
            ? {
                lat: latestSample.lat,
                lng: latestSample.lng,
                accuracyM: latestSample.accuracyM,
                capturedAt: latestSample.capturedAt,
              }
            : null,
          note: 'Unacknowledged SOS escalated to 112 gateway',
        });
      },
    });
    gatewaySent = gwRow.status === 'sent';
  }

  const [freshInc] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, incidentId))
    .limit(1);

  if (freshInc && freshInc.status === 'ACTIVE' && gatewaySent) {
    await transition(
      incidentId,
      'NOTIFIED',
      { type: 'system', id: 'escalation_gateway' },
      'Escalated to MockEmergencyGateway (112)',
      db
    );
  }

  const realHydrated = await getHydratedIncident(db, incidentId, undefined, {
    viewerRole: 'system',
  });
  broadcastIncidentUpdate(realHydrated);

  return { gatewaySent };
}
