import Dexie, { type Table } from 'dexie';
import {
  ApiError,
  incidentsApi,
  type CreateIncidentResponse,
  type TrustedContact,
} from './api';

export interface QueuedLocationSample {
  lat: number;
  lng: number;
  accuracy_m: number | null;
  captured_at: string;
}

export interface QueuedSosAlert {
  client_request_id: string;
  client_created_at: string;
  source_trigger: string;
  emergency_type: string | null;
  location: QueuedLocationSample | null;
  attempts: number;
  next_retry_at: number;
  status: 'queued' | 'retrying' | 'needs_reauth';
  last_error: string | null;
}

export interface CachedEmergencyContact {
  id: string;
  name: string;
  phone_e164: string;
  priority_order: number;
}

export class SaathiOfflineDatabase extends Dexie {
  queuedAlerts!: Table<QueuedSosAlert, string>;
  cachedContacts!: Table<CachedEmergencyContact, string>;

  constructor() {
    super('saathi_offline_db');
    this.version(1).stores({
      queuedAlerts: 'client_request_id, client_created_at, status, next_retry_at',
      cachedContacts: 'id, priority_order',
    });
  }
}

export const offlineDb = new SaathiOfflineDatabase();

// Fallback in-memory stores if IndexedDB is unavailable in a bare JSDOM test without fake-indexeddb
const memoryQueuedAlerts = new Map<string, QueuedSosAlert>();
const memoryCachedContacts = new Map<string, CachedEmergencyContact>();

type QueueChangeListener = () => void;
const queueChangeListeners = new Set<QueueChangeListener>();

type QueueFlushedListener = (
  clientRequestId: string,
  response: CreateIncidentResponse
) => void;
const queueFlushedListeners = new Set<QueueFlushedListener>();

export function subscribeQueueChange(
  listener: QueueChangeListener
): () => void {
  queueChangeListeners.add(listener);
  return () => {
    queueChangeListeners.delete(listener);
  };
}

export function subscribeQueueFlushed(
  listener: QueueFlushedListener
): () => void {
  queueFlushedListeners.add(listener);
  return () => {
    queueFlushedListeners.delete(listener);
  };
}

function notifyQueueChange(): void {
  for (const listener of queueChangeListeners) {
    try {
      listener();
    } catch {
      // ignore
    }
  }
}

function notifyQueueFlushed(
  clientRequestId: string,
  response: CreateIncidentResponse
): void {
  for (const listener of queueFlushedListeners) {
    try {
      listener(clientRequestId, response);
    } catch {
      // ignore
    }
  }
}

/**
 * Compute exponential backoff delay in ms with jitter:
 * baseMs * 2^min(attempts, 6) + random jitter (0..25% of baseMs)
 */
export function computeBackoffDelayMs(
  attempts: number,
  baseMs: number = 1000,
  randomFn: () => number = Math.random
): number {
  const exp = Math.min(Math.max(0, attempts), 6);
  const exponential = baseMs * Math.pow(2, exp);
  const jitter = Math.round(randomFn() * baseMs * 0.25);
  return exponential + jitter;
}

export async function enqueueOfflineAlert(
  entry: Omit<
    QueuedSosAlert,
    'attempts' | 'next_retry_at' | 'status' | 'last_error'
  > &
    Partial<
      Pick<
        QueuedSosAlert,
        'attempts' | 'next_retry_at' | 'status' | 'last_error'
      >
    >
): Promise<QueuedSosAlert> {
  const fullEntry: QueuedSosAlert = {
    client_request_id: entry.client_request_id,
    client_created_at: entry.client_created_at,
    source_trigger: entry.source_trigger,
    emergency_type: entry.emergency_type ?? null,
    location: entry.location ?? null,
    attempts: entry.attempts ?? 0,
    next_retry_at: entry.next_retry_at ?? Date.now(),
    status: entry.status ?? 'queued',
    last_error: entry.last_error ?? null,
  };

  memoryQueuedAlerts.set(fullEntry.client_request_id, fullEntry);
  notifyQueueChange();

  try {
    await offlineDb.queuedAlerts.put(fullEntry);
  } catch {
    // fallback to memoryQueuedAlerts if IDB unavailable
  }

  // Request Background Sync if supported by browser ServiceWorkerRegistration
  try {
    if (
      typeof navigator !== 'undefined' &&
      'serviceWorker' in navigator &&
      navigator.serviceWorker?.ready
    ) {
      void navigator.serviceWorker.ready
        .then((reg: any) => {
          if (reg?.sync && typeof reg.sync.register === 'function') {
            return reg.sync.register('saathi-sos-queue-sync');
          }
        })
        .catch(() => {
          // ignore
        });
    }
  } catch {
    // ignore
  }

  return fullEntry;
}

export async function updateQueuedAlertLocation(
  clientRequestId: string,
  location: QueuedLocationSample
): Promise<void> {
  const existingMem = memoryQueuedAlerts.get(clientRequestId);
  if (existingMem) {
    existingMem.location = location;
    memoryQueuedAlerts.set(clientRequestId, { ...existingMem });
  }
  try {
    const existingDb = await offlineDb.queuedAlerts.get(clientRequestId);
    if (existingDb) {
      await offlineDb.queuedAlerts.put({
        ...existingDb,
        location,
      });
    }
  } catch {
    // ignore
  }
  notifyQueueChange();
}

export async function updateQueuedAlertEmergencyType(
  clientRequestId: string,
  emergencyType: string
): Promise<void> {
  const existingMem = memoryQueuedAlerts.get(clientRequestId);
  if (existingMem) {
    existingMem.emergency_type = emergencyType;
    memoryQueuedAlerts.set(clientRequestId, { ...existingMem });
  }
  try {
    const existingDb = await offlineDb.queuedAlerts.get(clientRequestId);
    if (existingDb) {
      await offlineDb.queuedAlerts.put({
        ...existingDb,
        emergency_type: emergencyType,
      });
    }
  } catch {
    // ignore
  }
  notifyQueueChange();
}

/**
 * Task 4: Cancel while queued — removes the alert from the queue so it is never sent.
 */
export async function cancelQueuedAlert(
  clientRequestId: string
): Promise<boolean> {
  const hadMem = memoryQueuedAlerts.delete(clientRequestId);
  notifyQueueChange();
  let hadDb = false;
  try {
    const existing = await offlineDb.queuedAlerts.get(clientRequestId);
    if (existing) {
      hadDb = true;
      await offlineDb.queuedAlerts.delete(clientRequestId);
    }
  } catch {
    // ignore
  }
  return hadMem || hadDb;
}

export async function listQueuedAlerts(): Promise<QueuedSosAlert[]> {
  if (memoryQueuedAlerts.size > 0) {
    return Array.from(memoryQueuedAlerts.values()).sort((a, b) =>
      a.client_created_at.localeCompare(b.client_created_at)
    );
  }
  try {
    const rows = await offlineDb.queuedAlerts
      .orderBy('client_created_at')
      .toArray();
    for (const r of rows) {
      memoryQueuedAlerts.set(r.client_request_id, r);
    }
    return rows;
  } catch {
    return [];
  }
}

export async function clearAllQueuedAlerts(): Promise<void> {
  memoryQueuedAlerts.clear();
  try {
    await offlineDb.queuedAlerts.clear();
  } catch {
    // ignore
  }
  notifyQueueChange();
}

let isFlushing = false;

/**
 * Task 2, 3, 5 & 11: Flush queued alerts in FIFO order, reusing client_request_id
 * for idempotency. If 401 occurs after reconnecting and token refresh fails,
 * keeps the alert queued with status = 'needs_reauth' and never drops it silently.
 */
export async function flushOfflineAlertQueue(
  fetchImpl?: typeof fetch,
  options?: { baseBackoffMs?: number }
): Promise<{
  delivered: CreateIncidentResponse[];
  remaining: QueuedSosAlert[];
  needsReauth: boolean;
}> {
  if (isFlushing) {
    const current = await listQueuedAlerts();
    return {
      delivered: [],
      remaining: current,
      needsReauth: current.some((q) => q.status === 'needs_reauth'),
    };
  }

  isFlushing = true;
  const delivered: CreateIncidentResponse[] = [];
  let needsReauth = false;

  try {
    const queue = await listQueuedAlerts();
    for (const item of queue) {
      // Check if item was cancelled while flushing previous items
      const stillPresent = await listQueuedAlerts();
      if (
        !stillPresent.some(
          (q) => q.client_request_id === item.client_request_id
        )
      ) {
        continue;
      }

      try {
        // apiRequest inside createIncident automatically attempts /api/auth/refresh on 401
        const res = await incidentsApi.createIncident(
          {
            client_request_id: item.client_request_id,
            client_created_at: item.client_created_at,
            source_trigger: item.source_trigger,
            emergency_type: item.emergency_type,
            ...(item.location ? { location: item.location } : {}),
          },
          fetchImpl
        );

        await cancelQueuedAlert(item.client_request_id);
        delivered.push(res);
        notifyQueueFlushed(item.client_request_id, res);
      } catch (err) {
        const nextAttempts = item.attempts + 1;
        const delayMs = computeBackoffDelayMs(
          nextAttempts,
          options?.baseBackoffMs ?? 1000
        );

        if (err instanceof ApiError && err.status === 401) {
          // Task 5: Refresh failed -> keep alert queued, mark needs_reauth, never drop silently
          needsReauth = true;
          const updated: QueuedSosAlert = {
            ...item,
            attempts: nextAttempts,
            next_retry_at: Date.now() + delayMs,
            status: 'needs_reauth',
            last_error: 'Session expired. Please sign in to send your queued alert.',
          };
          memoryQueuedAlerts.set(item.client_request_id, updated);
          try {
            await offlineDb.queuedAlerts.put(updated);
          } catch {
            // ignore
          }
          notifyQueueChange();
          break;
        }

        const updated: QueuedSosAlert = {
          ...item,
          attempts: nextAttempts,
          next_retry_at: Date.now() + delayMs,
          status: 'retrying',
          last_error:
            err instanceof Error ? err.message : 'Network error; retrying',
        };
        memoryQueuedAlerts.set(item.client_request_id, updated);
        try {
          await offlineDb.queuedAlerts.put(updated);
        } catch {
          // ignore
        }
        notifyQueueChange();
      }
    }

    const remaining = await listQueuedAlerts();
    return {
      delivered,
      remaining,
      needsReauth:
        needsReauth || remaining.some((q) => q.status === 'needs_reauth'),
    };
  } finally {
    isFlushing = false;
  }
}

/**
 * Task 8: Contact cache for offline SMS.
 * Cache ONLY the name and phone_e164 (plus id and priority_order) of accepted,
 * consented SOS contacts on the device; refresh when online; clear on logout
 * or when data_processing consent is revoked.
 */
export async function syncOfflineEmergencyContactsCache(
  contacts: TrustedContact[],
  dataProcessingConsentGranted: boolean = true
): Promise<CachedEmergencyContact[]> {
  if (!dataProcessingConsentGranted) {
    await clearOfflineEmergencyContactsCache();
    return [];
  }

  const eligible: CachedEmergencyContact[] = contacts
    .filter((c) => c.status === 'accepted' && c.permissions?.receives_sos)
    .sort((a, b) => a.priority_order - b.priority_order)
    .map((c) => ({
      id: c.id,
      name: c.name,
      phone_e164: c.phone_e164,
      priority_order: c.priority_order,
    }));

  memoryCachedContacts.clear();
  for (const item of eligible) {
    memoryCachedContacts.set(item.id, item);
  }

  try {
    await offlineDb.transaction('rw', offlineDb.cachedContacts, async () => {
      await offlineDb.cachedContacts.clear();
      if (eligible.length > 0) {
        await offlineDb.cachedContacts.bulkPut(eligible);
      }
    });
  } catch {
    // fallback to memoryCachedContacts
  }

  return eligible;
}

export async function getCachedEmergencyContacts(): Promise<
  CachedEmergencyContact[]
> {
  if (memoryCachedContacts.size > 0) {
    return Array.from(memoryCachedContacts.values()).sort(
      (a, b) => a.priority_order - b.priority_order
    );
  }
  try {
    const rows = await offlineDb.cachedContacts
      .orderBy('priority_order')
      .toArray();
    for (const r of rows) {
      memoryCachedContacts.set(r.id, r);
    }
    return rows;
  } catch {
    return [];
  }
}

export async function clearOfflineEmergencyContactsCache(): Promise<void> {
  memoryCachedContacts.clear();
  try {
    await offlineDb.cachedContacts.clear();
  } catch {
    // ignore
  }
}

/**
 * Task 7: SMS Fallback Link Builder.
 * Handles Android vs iOS `sms:` URI differences:
 * - iOS Single Contact: `sms:+919876543210&body=<encoded>`
 * - iOS Group Contacts: `sms://open?addresses=+919876543210,+919876543211&body=<encoded>`
 * - Android / Standard: `sms:+919876543210,+919876543211?body=<encoded>`
 */
export function detectSmsPlatform(userAgent?: string): 'ios' | 'android' {
  const ua = (
    userAgent ??
    (typeof navigator !== 'undefined' ? navigator.userAgent : '')
  ).toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) {
    return 'ios';
  }
  return 'android';
}

export function buildEmergencySmsBody(options: {
  userName?: string;
  location?: QueuedLocationSample | null;
  triggeredAtIso?: string;
}): string {
  const namePart = options.userName ? ` from ${options.userName}` : '';
  const timeStr = options.triggeredAtIso
    ? new Date(options.triggeredAtIso).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  let locPart = 'Location unavailable.';
  if (
    options.location &&
    typeof options.location.lat === 'number' &&
    typeof options.location.lng === 'number'
  ) {
    const lat = options.location.lat.toFixed(5);
    const lng = options.location.lng.toFixed(5);
    const mapUrl = `https://maps.google.com/?q=${lat},${lng}`;
    locPart = `Last known location: ${mapUrl}`;
  }

  return `SAATHI SOS Emergency Alert${namePart} (${timeStr}). I need help. ${locPart}`;
}

export function buildSmsFallbackHref(
  phones: string[],
  bodyText: string,
  platform: 'ios' | 'android' = detectSmsPlatform()
): string {
  const cleaned = phones.map((p) => p.trim()).filter(Boolean);
  const encodedBody = encodeURIComponent(bodyText);

  if (cleaned.length === 0) {
    return platform === 'ios'
      ? `sms:&body=${encodedBody}`
      : `sms:?body=${encodedBody}`;
  }

  if (platform === 'ios') {
    if (cleaned.length === 1) {
      return `sms:${cleaned[0]}&body=${encodedBody}`;
    }
    return `sms://open?addresses=${cleaned.join(',')}&body=${encodedBody}`;
  }

  return `sms:${cleaned.join(',')}?body=${encodedBody}`;
}
