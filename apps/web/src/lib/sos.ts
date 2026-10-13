import {
  incidentsApi,
  type CreateIncidentResponse,
  type IncidentDto,
} from './api';
import {
  enqueueOfflineAlert,
  type QueuedLocationSample,
} from './offlineQueue';

export interface TriggerSosResult extends CreateIncidentResponse {
  queued_offline?: boolean;
}

type SosTriggerListener = (response: TriggerSosResult) => void;
const listeners = new Set<SosTriggerListener>();

type PracticeTriggerListener = (source: string) => void;
const practiceListeners = new Set<PracticeTriggerListener>();
let activePracticeTargetSource: string | null = null;

export function subscribeSosTrigger(
  listener: SosTriggerListener
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function subscribePracticeTrigger(
  listener: PracticeTriggerListener
): () => void {
  practiceListeners.add(listener);
  return () => {
    practiceListeners.delete(listener);
  };
}

export function setPracticeModeTarget(source: string | null): void {
  activePracticeTargetSource = source;
}

export function getPracticeModeTarget(): string | null {
  return activePracticeTargetSource;
}

/**
 * Single unified entry point for all SOS triggers (hold button in 4A,
 * and shake / voice / triple-tap / shortcut / disguise triggers in 4B).
 * Phase 5: If the browser is offline or POST /api/incidents fails due to
 * connectivity, stores the alert in Dexie/IndexedDB with its client_request_id
 * so retries never create duplicates.
 */
export async function triggerSos(
  source: string = 'button',
  fetchImpl?: typeof fetch,
  options?: {
    clientRequestId?: string;
    location?: QueuedLocationSample | null;
  }
): Promise<TriggerSosResult> {
  if (activePracticeTargetSource !== null) {
    for (const listener of practiceListeners) {
      try {
        listener(source);
      } catch {
        // ignore listener errors
      }
    }
    const nowIso = new Date().toISOString();
    return {
      incident: {
        id: `practice_${Date.now()}`,
        user_id: 'practice',
        status: 'CANCELLED',
        emergency_type: null,
        client_request_id: `practice_req_${Date.now()}`,
        created_at: nowIso,
        activated_at: null,
        closed_at: nowIso,
        merged_into_id: null,
        source_trigger: source,
        is_duress: false,
        needs_user_action: false,
        escalation_stage: 0,
        auto_expire_minutes: 60,
      },
      idempotent_replay: false,
      merged_into_existing: false,
      notifiable_contacts_count: 0,
    };
  }

  const clientRequestId =
    options?.clientRequestId ||
    `sos_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const clientCreatedAt = new Date().toISOString();

  const isBrowserOffline =
    typeof navigator !== 'undefined' && navigator.onLine === false;

  if (!isBrowserOffline) {
    try {
      const response = await incidentsApi.createIncident(
        {
          client_request_id: clientRequestId,
          client_created_at: clientCreatedAt,
          source_trigger: source,
          ...(options?.location ? { location: options.location } : {}),
        },
        fetchImpl
      );

      for (const listener of listeners) {
        try {
          listener(response);
        } catch {
          // ignore listener errors
        }
      }

      return response;
    } catch {
      // Network/server failure -> fall through to offline queue
    }
  }

  const queuedResponse: TriggerSosResult = {
    incident: {
      id: `queued_${clientRequestId}`,
      user_id: 'local',
      status: 'TRIGGERED',
      emergency_type: null,
      client_request_id: clientRequestId,
      created_at: clientCreatedAt,
      activated_at: null,
      closed_at: null,
      merged_into_id: null,
      source_trigger: source,
      is_duress: false,
      needs_user_action: false,
      escalation_stage: 0,
      auto_expire_minutes: 60,
    },
    idempotent_replay: false,
    merged_into_existing: false,
    queued_offline: true,
  };

  // Enqueue in IndexedDB (Dexie) BEFORE notifying UI listeners so refreshQueuedAlertsState sees the entry immediately
  await enqueueOfflineAlert({
    client_request_id: clientRequestId,
    client_created_at: clientCreatedAt,
    source_trigger: source,
    emergency_type: null,
    location: options?.location ?? null,
  });

  for (const listener of listeners) {
    try {
      listener(queuedResponse);
    } catch {
      // ignore listener errors
    }
  }

  return queuedResponse;
}

export function isOpenIncident(incident: IncidentDto | null): boolean {
  if (!incident) return false;
  return (
    incident.status === 'TRIGGERED' ||
    incident.status === 'ACTIVE' ||
    incident.status === 'NOTIFIED' ||
    incident.status === 'ACKNOWLEDGED' ||
    incident.status === 'RESPONDING' ||
    incident.status === 'ESCALATED'
  );
}
