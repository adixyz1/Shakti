import { asc, isNull } from 'drizzle-orm';
import { isDemoModeEnabled } from '../core/config';
import { getDb, type AppDatabase } from '../core/db';
import {
  consents,
  incidentEvents,
  incidents,
  locationSamples,
  notifications,
  postIncidentRatings,
  safetyPulses,
  type ConsentRow,
  type IncidentEventRow,
  type IncidentRow,
  type IncidentStatus,
} from '../db/schema';
import { HttpError } from './authService';
import { ALLOWED_TRANSITIONS } from './incidentStateMachine';

export const MIN_SAMPLE_SIZE = 5;

export function roundMetric(val: number): number {
  return Math.round(val * 100) / 100;
}

/**
 * Standard median of a numeric array:
 * - For odd n: sorted[(n - 1) / 2]
 * - For even n: (sorted[n / 2 - 1] + sorted[n / 2]) / 2
 */
export function computeMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return roundMetric(sorted[mid]);
  }
  return roundMetric((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Nearest-rank 90th percentile:
 * sorted[Math.ceil(0.9 * n) - 1]
 */
export function computePercentile90(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(0.9 * sorted.length) - 1));
  return roundMetric(sorted[idx]);
}

/**
 * Computes ISO week label ("YYYY-Www") and Monday week_start ("YYYY-MM-DD") in UTC.
 */
export function getIsoWeekBucket(dateStr: string): {
  week: string;
  week_start: string;
} {
  const normalized =
    dateStr.length === 10 ? `${dateStr}T00:00:00.000Z` : dateStr;
  const d = new Date(normalized);
  const utc = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
  const dayNum = utc.getUTCDay() || 7; // Monday=1 .. Sunday=7

  // Monday of this week
  const monday = new Date(utc);
  monday.setUTCDate(utc.getUTCDate() - (dayNum - 1));
  const weekStart = monday.toISOString().slice(0, 10);

  // Thursday in current week decides ISO week year
  const thursday = new Date(utc);
  thursday.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );
  const weekLabel = `${thursday.getUTCFullYear()}-W${String(weekNo).padStart(
    2,
    '0'
  )}`;

  return { week: weekLabel, week_start: weekStart };
}

/**
 * Validates whether an incident's `incident_events` rows form a contiguous, valid
 * state-machine chain starting at TRIGGERED and ending at `incident.status`.
 */
export function isIncidentAuditChainValid(
  incident: IncidentRow,
  events: IncidentEventRow[]
): boolean {
  if (events.length === 0) {
    return false;
  }

  // Sort chronologically; if timestamps are equal, initial creation (fromStatus === null) comes first
  const sorted = [...events].sort((a, b) => {
    if (a.createdAt !== b.createdAt) {
      return a.createdAt.localeCompare(b.createdAt);
    }
    if (a.fromStatus === null && b.fromStatus !== null) return -1;
    if (a.fromStatus !== null && b.fromStatus === null) return 1;
    return 0;
  });

  const first = sorted[0];
  if (first.toStatus !== 'TRIGGERED') {
    return false;
  }
  if (first.fromStatus !== null && first.fromStatus !== 'TRIGGERED') {
    return false;
  }

  let currentStatus: IncidentStatus = 'TRIGGERED';

  for (let i = 1; i < sorted.length; i++) {
    const ev = sorted[i];
    if (ev.fromStatus !== currentStatus) {
      return false;
    }
    if (ev.toStatus === currentStatus) {
      // Self-loop metadata event (e.g., emergency_type set, duress note, operational note)
      continue;
    }
    const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(ev.toStatus)) {
      return false;
    }
    currentStatus = ev.toStatus;
  }

  return currentStatus === incident.status;
}

export interface MetricEntryDto<TExtra = Record<string, unknown>> {
  metric: string;
  value: number | null;
  n: number;
  target: string | null;
  formula: string;
  insufficient_data: boolean;
  details?: TExtra;
  [key: string]: unknown;
}

export interface ImpactMetricsResponseDto {
  range: {
    from: string;
    to: string;
  };
  minimum_sample_size: number;
  includes_demo_data: boolean;
  metrics: {
    alert_initiation_time: MetricEntryDto;
    time_to_active: MetricEntryDto;
    notification_delivery_rate: MetricEntryDto;
    time_to_first_acknowledgement: MetricEntryDto;
    time_to_resolution: MetricEntryDto;
    cancellation_rate: MetricEntryDto;
    false_alarm_rate: MetricEntryDto;
    location_availability: MetricEntryDto;
    audit_completeness: MetricEntryDto;
    safety_pulse: MetricEntryDto;
    post_incident_trust_score: MetricEntryDto;
  };
}

export function parseDateRange(
  fromParam?: string,
  toParam?: string,
  nowMs: number = Date.now()
): { fromIso: string; toIso: string; fromMs: number; toMs: number } {
  const defaultToMs = nowMs;
  const defaultFromMs = nowMs - 30 * 24 * 60 * 60 * 1000;

  let fromMs = defaultFromMs;
  let toMs = defaultToMs;

  if (fromParam && fromParam.trim().length > 0) {
    const trimmed = fromParam.trim();
    const normalized =
      /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
        ? `${trimmed}T00:00:00.000Z`
        : trimmed;
    const parsed = Date.parse(normalized);
    if (Number.isNaN(parsed)) {
      throw new HttpError(422, 'Invalid "from" date parameter.');
    }
    fromMs = parsed;
  }

  if (toParam && toParam.trim().length > 0) {
    const trimmed = toParam.trim();
    const normalized =
      /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
        ? `${trimmed}T23:59:59.999Z`
        : trimmed;
    const parsed = Date.parse(normalized);
    if (Number.isNaN(parsed)) {
      throw new HttpError(422, 'Invalid "to" date parameter.');
    }
    toMs = parsed;
  }

  if (fromMs > toMs) {
    throw new HttpError(422, '"from" date must not be after "to" date.');
  }

  return {
    fromIso: new Date(fromMs).toISOString(),
    toIso: new Date(toMs).toISOString(),
    fromMs,
    toMs,
  };
}

function isTimestampInRange(
  isoOrDate: string,
  fromMs: number,
  toMs: number,
  fromIso: string,
  toIso: string
): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrDate)) {
    const fromDate = fromIso.slice(0, 10);
    const toDate = toIso.slice(0, 10);
    return isoOrDate >= fromDate && isoOrDate <= toDate;
  }
  const ms = Date.parse(isoOrDate);
  if (Number.isNaN(ms)) return false;
  return ms >= fromMs && ms <= toMs;
}

export async function computeImpactMetrics(
  dbInstance?: AppDatabase,
  options?: {
    from?: string;
    to?: string;
    nowMs?: number;
    includeDemo?: boolean;
  }
): Promise<ImpactMetricsResponseDto> {
  const db = dbInstance || getDb();
  const includeDemo = isDemoModeEnabled(options?.includeDemo);
  const { fromIso, toIso, fromMs, toMs } = parseDateRange(
    options?.from,
    options?.to,
    options?.nowMs
  );

  // Load primary incidents (excluding shadow duplicate merges) and filter by date range and demo mode
  const allPrimaryIncidents = await db
    .select()
    .from(incidents)
    .where(isNull(incidents.mergedIntoId))
    .orderBy(asc(incidents.createdAt));

  const demoIncidentIds = new Set(
    allPrimaryIncidents.filter((inc) => Boolean(inc.isDemo)).map((inc) => inc.id)
  );

  const incidentsInRange = allPrimaryIncidents.filter(
    (inc) =>
      (includeDemo || !inc.isDemo) &&
      isTimestampInRange(inc.createdAt, fromMs, toMs, fromIso, toIso)
  );
  const incidentIdsInRange = new Set(incidentsInRange.map((i) => i.id));

  // Load related events, location samples, notifications, consents, pulses, and ratings
  const allEvents = await db
    .select()
    .from(incidentEvents)
    .orderBy(asc(incidentEvents.createdAt));
  const eventsByIncidentId = new Map<string, IncidentEventRow[]>();
  for (const ev of allEvents) {
    if (!incidentIdsInRange.has(ev.incidentId)) continue;
    const list = eventsByIncidentId.get(ev.incidentId) || [];
    list.push(ev);
    eventsByIncidentId.set(ev.incidentId, list);
  }

  const allLocations = await db
    .select()
    .from(locationSamples)
    .orderBy(asc(locationSamples.capturedAt));
  const locationsByIncidentId = new Map<string, typeof allLocations>();
  for (const loc of allLocations) {
    if (!incidentIdsInRange.has(loc.incidentId)) continue;
    const list = locationsByIncidentId.get(loc.incidentId) || [];
    list.push(loc);
    locationsByIncidentId.set(loc.incidentId, list);
  }

  const allNotifications = await db
    .select()
    .from(notifications)
    .orderBy(asc(notifications.createdAt));
  const notificationsInRange = allNotifications.filter(
    (n) =>
      (includeDemo || !demoIncidentIds.has(n.incidentId)) &&
      (incidentIdsInRange.has(n.incidentId) ||
        isTimestampInRange(n.createdAt, fromMs, toMs, fromIso, toIso))
  );

  const allConsents = await db
    .select()
    .from(consents)
    .orderBy(asc(consents.createdAt));
  const locationConsentsByUser = new Map<string, ConsentRow[]>();
  for (const c of allConsents) {
    if (c.type !== 'location') continue;
    const list = locationConsentsByUser.get(c.userId) || [];
    list.push(c);
    locationConsentsByUser.set(c.userId, list);
  }

  const allPulses = await db
    .select()
    .from(safetyPulses)
    .orderBy(asc(safetyPulses.createdAt));
  const pulsesInRange = allPulses.filter(
    (p) =>
      (includeDemo || !p.isDemo) &&
      isTimestampInRange(p.createdAt, fromMs, toMs, fromIso, toIso)
  );

  const allRatings = await db
    .select()
    .from(postIncidentRatings)
    .orderBy(asc(postIncidentRatings.createdAt));
  const ratingsInRange = allRatings.filter(
    (r) =>
      (includeDemo || !demoIncidentIds.has(r.incidentId)) &&
      (incidentIdsInRange.has(r.incidentId) ||
        isTimestampInRange(r.createdAt, fromMs, toMs, fromIso, toIso))
  );

  // Helper to get when an incident reached ACTIVE (if it did)
  const getActiveTimestampIso = (inc: IncidentRow): string | null => {
    if (inc.activatedAt) {
      return inc.activatedAt;
    }
    const evs = eventsByIncidentId.get(inc.id) || [];
    const activeEv = evs.find((e) => e.toStatus === 'ACTIVE');
    return activeEv ? activeEv.createdAt : null;
  };

  const activeIncidents = incidentsInRange.filter(
    (inc) => getActiveTimestampIso(inc) !== null
  );

  // =========================================================================
  // 1. Alert-initiation time: client_created_at -> server created_at
  //    Online incidents only; queued/offline-created reported separately as
  //    "queued-then-delivered". Cancel window is NOT part of initiation time.
  //    Exclude implausible initiation values (negative, or over 300 seconds)
  //    from the initiation-time median and report excluded_implausible.
  //    Target: under 10 s.
  // =========================================================================
  const onlineInitiationSeconds: number[] = [];
  const queuedInitiationSeconds: number[] = [];
  let excludedImplausibleCount = 0;

  for (const inc of incidentsInRange) {
    if (!inc.clientCreatedAt) continue;
    const clientMs = Date.parse(inc.clientCreatedAt);
    const serverMs = Date.parse(inc.createdAt);
    if (Number.isNaN(clientMs) || Number.isNaN(serverMs)) continue;
    const rawDiffSec = (serverMs - clientMs) / 1000;

    if (inc.queuedOffline) {
      if (rawDiffSec >= 0) {
        queuedInitiationSeconds.push(rawDiffSec);
      }
    } else {
      if (rawDiffSec < 0 || rawDiffSec > 300) {
        excludedImplausibleCount += 1;
      } else {
        onlineInitiationSeconds.push(rawDiffSec);
      }
    }
  }

  const initN = onlineInitiationSeconds.length;
  const initInsufficient = initN < MIN_SAMPLE_SIZE;
  const initMedian = initInsufficient
    ? null
    : computeMedian(onlineInitiationSeconds);

  const queuedN = queuedInitiationSeconds.length;
  const queuedInsufficient = queuedN < MIN_SAMPLE_SIZE;
  const queuedMedian = queuedInsufficient
    ? null
    : computeMedian(queuedInitiationSeconds);

  const alertInitiationMetric: MetricEntryDto = {
    metric: 'alert_initiation_time',
    value: initMedian,
    unit: 'seconds',
    n: initN,
    excluded_implausible: excludedImplausibleCount,
    target: 'under 10 s',
    formula:
      'median(server_created_at - client_created_at) in seconds for online-created incidents with 0 <= duration <= 300s (excludes queued-then-delivered and implausible clock skew; cancel window excluded)',
    insufficient_data: initInsufficient,
    queued_then_delivered: {
      label: 'queued-then-delivered',
      n: queuedN,
      value: queuedMedian,
      insufficient_data: queuedInsufficient,
    },
  };

  // =========================================================================
  // 2. Time to active: created_at -> ACTIVE (includes cancel window; informational)
  // =========================================================================
  const timeToActiveSeconds: number[] = [];
  for (const inc of activeIncidents) {
    const activeIso = getActiveTimestampIso(inc)!;
    const diffSec = Math.max(
      0,
      (Date.parse(activeIso) - Date.parse(inc.createdAt)) / 1000
    );
    timeToActiveSeconds.push(diffSec);
  }
  const ttaN = timeToActiveSeconds.length;
  const ttaInsufficient = ttaN < MIN_SAMPLE_SIZE;
  const timeToActiveMetric: MetricEntryDto = {
    metric: 'time_to_active',
    value: ttaInsufficient ? null : computeMedian(timeToActiveSeconds),
    unit: 'seconds',
    n: ttaN,
    target: 'informational (includes cancel window)',
    informational: true,
    formula:
      'median(activated_at - created_at) in seconds (includes user cancel window)',
    insufficient_data: ttaInsufficient,
  };

  // =========================================================================
  // 3. Notification delivery rate: sent/delivered / all attempted, overall & per channel
  //    Target: above 95% (mock providers: label "test environment")
  // =========================================================================
  const notifN = notificationsInRange.length;
  const notifInsufficient = notifN < MIN_SAMPLE_SIZE;
  const notifSucceeded = notificationsInRange.filter(
    (n) => n.status === 'sent' || n.status === 'delivered'
  ).length;
  const notifOverallRate = notifInsufficient
    ? null
    : roundMetric((notifSucceeded / notifN) * 100);

  const channels = ['sms', 'push', 'gateway'] as const;
  const byChannel: Record<
    string,
    {
      n: number;
      succeeded: number;
      value: number | null;
      rate_percent: number | null;
      insufficient_data: boolean;
    }
  > = {};

  for (const ch of channels) {
    const chRows = notificationsInRange.filter((n) => n.channel === ch);
    const chN = chRows.length;
    const chSucc = chRows.filter(
      (n) => n.status === 'sent' || n.status === 'delivered'
    ).length;
    const chInsuff = chN < MIN_SAMPLE_SIZE;
    const rawPct = chN > 0 ? roundMetric((chSucc / chN) * 100) : null;
    byChannel[ch] = {
      n: chN,
      succeeded: chSucc,
      value: chInsuff ? null : rawPct,
      rate_percent: chInsuff ? null : rawPct,
      insufficient_data: chInsuff,
    };
  }

  const notificationDeliveryMetric: MetricEntryDto = {
    metric: 'notification_delivery_rate',
    value: notifOverallRate,
    succeeded: notifSucceeded,
    unit: 'percent',
    n: notifN,
    target: 'above 95%',
    environment_label: 'test environment',
    formula:
      "count(status IN ('sent','delivered')) / count(all_notifications_attempted) * 100",
    insufficient_data: notifInsufficient,
    by_channel: byChannel,
  };

  // =========================================================================
  // 4. Time to first acknowledgement: ACTIVE -> first ACKNOWLEDGED event,
  //    median and 90th percentile
  // =========================================================================
  const ackDurationsSeconds: number[] = [];
  for (const inc of activeIncidents) {
    const activeIso = getActiveTimestampIso(inc)!;
    const evs = eventsByIncidentId.get(inc.id) || [];
    const firstAck = evs.find((e) => e.toStatus === 'ACKNOWLEDGED');
    if (firstAck) {
      const diffSec = Math.max(
        0,
        (Date.parse(firstAck.createdAt) - Date.parse(activeIso)) / 1000
      );
      ackDurationsSeconds.push(diffSec);
    }
  }
  const ackN = ackDurationsSeconds.length;
  const ackInsufficient = ackN < MIN_SAMPLE_SIZE;
  const ackMedian = ackInsufficient ? null : computeMedian(ackDurationsSeconds);
  const ackP90 = ackInsufficient
    ? null
    : computePercentile90(ackDurationsSeconds);

  const timeToFirstAckMetric: MetricEntryDto = {
    metric: 'time_to_first_acknowledgement',
    value: ackMedian,
    median_seconds: ackMedian,
    p90_seconds: ackP90,
    unit: 'seconds',
    n: ackN,
    target: null,
    formula:
      'median and p90 of (first_ACKNOWLEDGED_event.created_at - activated_at) in seconds',
    insufficient_data: ackInsufficient,
  };

  // =========================================================================
  // 5. Time to resolution: ACTIVE -> RESOLVED, median
  // =========================================================================
  const resolutionDurationsSeconds: number[] = [];
  for (const inc of activeIncidents) {
    const activeIso = getActiveTimestampIso(inc)!;
    const evs = eventsByIncidentId.get(inc.id) || [];
    const resolvedEv = [...evs]
      .reverse()
      .find((e) => e.toStatus === 'RESOLVED');
    const resolvedIso =
      resolvedEv?.createdAt ||
      (inc.status === 'RESOLVED' ? inc.closedAt : null);
    if (resolvedIso) {
      const diffSec = Math.max(
        0,
        (Date.parse(resolvedIso) - Date.parse(activeIso)) / 1000
      );
      resolutionDurationsSeconds.push(diffSec);
    }
  }
  const resN = resolutionDurationsSeconds.length;
  const resInsufficient = resN < MIN_SAMPLE_SIZE;
  const resMedian = resInsufficient
    ? null
    : computeMedian(resolutionDurationsSeconds);

  const timeToResolutionMetric: MetricEntryDto = {
    metric: 'time_to_resolution',
    value: resMedian,
    median_seconds: resMedian,
    unit: 'seconds',
    n: resN,
    target: null,
    formula: 'median(resolved_at - activated_at) in seconds',
    insufficient_data: resInsufficient,
  };

  // =========================================================================
  // 6. Cancellation rate: CANCELLED / all incidents.
  //    False-alarm rate: FALSE_ALARM / incidents that reached ACTIVE.
  // =========================================================================
  const totalIncidentsN = incidentsInRange.length;
  const cancelInsufficient = totalIncidentsN < MIN_SAMPLE_SIZE;
  const cancelledCount = incidentsInRange.filter(
    (inc) => inc.status === 'CANCELLED'
  ).length;
  const cancellationRateVal = cancelInsufficient
    ? null
    : roundMetric((cancelledCount / totalIncidentsN) * 100);

  const cancellationRateMetric: MetricEntryDto = {
    metric: 'cancellation_rate',
    value: cancellationRateVal,
    cancelled_count: cancelledCount,
    unit: 'percent',
    n: totalIncidentsN,
    target: null,
    formula: "count(status = 'CANCELLED') / count(all_incidents) * 100",
    insufficient_data: cancelInsufficient,
  };

  const activeIncidentsN = activeIncidents.length;
  const falseAlarmInsufficient = activeIncidentsN < MIN_SAMPLE_SIZE;
  const falseAlarmCount = activeIncidents.filter(
    (inc) => inc.status === 'FALSE_ALARM'
  ).length;
  const falseAlarmRateVal = falseAlarmInsufficient
    ? null
    : roundMetric((falseAlarmCount / activeIncidentsN) * 100);

  const falseAlarmRateMetric: MetricEntryDto = {
    metric: 'false_alarm_rate',
    value: falseAlarmRateVal,
    false_alarm_count: falseAlarmCount,
    unit: 'percent',
    n: activeIncidentsN,
    target: null,
    formula:
      "count(status = 'FALSE_ALARM' among active) / count(incidents_reaching_ACTIVE) * 100",
    insufficient_data: falseAlarmInsufficient,
  };

  // =========================================================================
  // 7. Location availability: % of incidents that reached ACTIVE with >= 1
  //    location sample, plus median accuracy in meters. Also report separately
  //    how many had location consent off.
  // =========================================================================
  let activeWithLocationCount = 0;
  let locationConsentOffCount = 0;
  const accuracyMetersList: number[] = [];

  for (const inc of activeIncidents) {
    const locs = locationsByIncidentId.get(inc.id) || [];
    if (locs.length > 0) {
      activeWithLocationCount += 1;
      for (const l of locs) {
        if (typeof l.accuracyM === 'number' && Number.isFinite(l.accuracyM)) {
          accuracyMetersList.push(l.accuracyM);
        }
      }
    }

    // Check if user had location consent off at the time of the incident
    const userLocConsents = locationConsentsByUser.get(inc.userId) || [];
    const priorConsents = userLocConsents.filter(
      (c) => c.createdAt <= inc.createdAt
    );
    const relevantConsent =
      priorConsents.length > 0
        ? priorConsents[priorConsents.length - 1]
        : userLocConsents[userLocConsents.length - 1];

    if (relevantConsent) {
      if (!relevantConsent.granted) {
        locationConsentOffCount += 1;
      }
    } else if (locs.length === 0) {
      // No location consent granted in ledger and no location samples captured
      locationConsentOffCount += 1;
    }
  }

  const locAvailInsufficient = activeIncidentsN < MIN_SAMPLE_SIZE;
  const locAvailPercent = locAvailInsufficient
    ? null
    : roundMetric((activeWithLocationCount / activeIncidentsN) * 100);
  const medianAccuracyMeters =
    locAvailInsufficient || accuracyMetersList.length < MIN_SAMPLE_SIZE
      ? null
      : computeMedian(accuracyMetersList);

  const locationAvailabilityMetric: MetricEntryDto = {
    metric: 'location_availability',
    value: locAvailPercent,
    active_with_location_count: activeWithLocationCount,
    median_accuracy_meters: medianAccuracyMeters,
    location_consent_off_count: locationConsentOffCount,
    unit: 'percent',
    n: activeIncidentsN,
    target: null,
    formula:
      'count(active_incidents_with_location_sample) / count(incidents_reaching_ACTIVE) * 100; median(location_samples.accuracy_m)',
    insufficient_data: locAvailInsufficient,
  };

  // =========================================================================
  // 8. Audit completeness: % of incidents whose incident_events form a valid
  //    chain from TRIGGERED to the current status (target 100%)
  // =========================================================================
  let validAuditCount = 0;
  for (const inc of incidentsInRange) {
    const evs = eventsByIncidentId.get(inc.id) || [];
    if (isIncidentAuditChainValid(inc, evs)) {
      validAuditCount += 1;
    }
  }
  const auditInsufficient = totalIncidentsN < MIN_SAMPLE_SIZE;
  const auditCompletenessVal = auditInsufficient
    ? null
    : roundMetric((validAuditCount / totalIncidentsN) * 100);

  const auditCompletenessMetric: MetricEntryDto = {
    metric: 'audit_completeness',
    value: auditCompletenessVal,
    valid_chain_count: validAuditCount,
    unit: 'percent',
    n: totalIncidentsN,
    target: '100%',
    formula:
      'count(incidents_with_valid_incident_events_chain_from_TRIGGERED_to_current_status) / count(all_incidents) * 100',
    insufficient_data: auditInsufficient,
  };

  // =========================================================================
  // 9. Safety pulse: average score, % "avoided going somewhere", by week
  // =========================================================================
  const pulseN = pulsesInRange.length;
  const pulseInsufficient = pulseN < MIN_SAMPLE_SIZE;
  const pulseScoreSum = pulsesInRange.reduce((acc, p) => acc + p.safetyScore, 0);
  const pulseAvoidedCount = pulsesInRange.filter(
    (p) => Boolean(p.avoidedGoingSomewhere)
  ).length;
  const pulseAvgScore = pulseInsufficient
    ? null
    : roundMetric(pulseScoreSum / pulseN);
  const pulseAvoidedPct = pulseInsufficient
    ? null
    : roundMetric((pulseAvoidedCount / pulseN) * 100);

  const weeklyMap = new Map<
    string,
    {
      week: string;
      week_start: string;
      scores: number[];
      avoidedCount: number;
    }
  >();

  for (const p of pulsesInRange) {
    const { week, week_start } = getIsoWeekBucket(p.createdAt);
    const bucket = weeklyMap.get(week) || {
      week,
      week_start,
      scores: [],
      avoidedCount: 0,
    };
    bucket.scores.push(p.safetyScore);
    if (p.avoidedGoingSomewhere) {
      bucket.avoidedCount += 1;
    }
    weeklyMap.set(week, bucket);
  }

  const byWeek = Array.from(weeklyMap.values())
    .sort((a, b) => a.week_start.localeCompare(b.week_start))
    .map((b) => {
      const wN = b.scores.length;
      const wInsuff = wN < MIN_SAMPLE_SIZE;
      const wAvg = wInsuff
        ? null
        : roundMetric(b.scores.reduce((s, v) => s + v, 0) / wN);
      const wAvoidedPct = wInsuff
        ? null
        : roundMetric((b.avoidedCount / wN) * 100);
      return {
        week: b.week,
        week_start: b.week_start,
        n: wN,
        value: wAvg,
        average_score: wAvg,
        avoided_going_somewhere_percent: wAvoidedPct,
        insufficient_data: wInsuff,
      };
    });

  const safetyPulseMetric: MetricEntryDto = {
    metric: 'safety_pulse',
    value: pulseAvgScore,
    average_score: pulseAvgScore,
    avoided_going_somewhere_percent: pulseAvoidedPct,
    unit: 'score_1_to_5',
    n: pulseN,
    target: null,
    formula:
      'avg(safety_score) and count(avoided_going_somewhere = true) / count(safety_pulses) * 100, overall and by ISO week',
    insufficient_data: pulseInsufficient,
    by_week: byWeek,
  };

  // =========================================================================
  // 10. Post-incident trust score: average of optional 1-5 rating
  // =========================================================================
  const ratingsN = ratingsInRange.length;
  const ratingsInsufficient = ratingsN < MIN_SAMPLE_SIZE;
  const ratingsSum = ratingsInRange.reduce((acc, r) => acc + r.score, 0);
  const trustAvg = ratingsInsufficient
    ? null
    : roundMetric(ratingsSum / ratingsN);

  const postIncidentTrustMetric: MetricEntryDto = {
    metric: 'post_incident_trust_score',
    value: trustAvg,
    unit: 'score_1_to_5',
    n: ratingsN,
    target: null,
    formula: 'avg(post_incident_ratings.score) on 1-5 scale',
    insufficient_data: ratingsInsufficient,
  };

  return {
    range: {
      from: fromIso,
      to: toIso,
    },
    minimum_sample_size: MIN_SAMPLE_SIZE,
    includes_demo_data: includeDemo,
    metrics: {
      alert_initiation_time: alertInitiationMetric,
      time_to_active: timeToActiveMetric,
      notification_delivery_rate: notificationDeliveryMetric,
      time_to_first_acknowledgement: timeToFirstAckMetric,
      time_to_resolution: timeToResolutionMetric,
      cancellation_rate: cancellationRateMetric,
      false_alarm_rate: falseAlarmRateMetric,
      location_availability: locationAvailabilityMetric,
      audit_completeness: auditCompletenessMetric,
      safety_pulse: safetyPulseMetric,
      post_incident_trust_score: postIncidentTrustMetric,
    },
  };
}

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function formatImpactMetricsCsv(data: ImpactMetricsResponseDto): string {
  const headers = [
    'metric',
    'value',
    'n',
    'target',
    'formula',
    'insufficient_data',
  ];
  const rows: string[] = [headers.join(',')];

  const orderedEntries: MetricEntryDto[] = [
    data.metrics.alert_initiation_time,
    data.metrics.time_to_active,
    data.metrics.notification_delivery_rate,
    data.metrics.time_to_first_acknowledgement,
    data.metrics.time_to_resolution,
    data.metrics.cancellation_rate,
    data.metrics.false_alarm_rate,
    data.metrics.location_availability,
    data.metrics.audit_completeness,
    data.metrics.safety_pulse,
    data.metrics.post_incident_trust_score,
  ];

  for (const entry of orderedEntries) {
    const line = [
      escapeCsvCell(entry.metric),
      escapeCsvCell(entry.value),
      escapeCsvCell(entry.n),
      escapeCsvCell(entry.target),
      escapeCsvCell(entry.formula),
      escapeCsvCell(entry.insufficient_data),
    ].join(',');
    rows.push(line);
  }

  return rows.join('\n') + '\n';
}
