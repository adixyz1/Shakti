import { UserProfile } from '../store/authStore';

const API_BASE =
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_API_BASE_URL || '/api';

export class ApiError extends Error {
  public status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

async function attemptTokenRefresh(fetchImpl: typeof fetch): Promise<boolean> {
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }
  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const res = await fetchImpl(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  fetchImpl: typeof fetch = fetch
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const config: RequestInit = {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  };

  let response = await fetchImpl(url, config);

  // Automatic token refresh on 401 (except when calling auth or public invitation endpoints)
  if (
    response.status === 401 &&
    !path.startsWith('/auth/otp') &&
    !path.startsWith('/invitations/') &&
    path !== '/auth/refresh'
  ) {
    const refreshed = await attemptTokenRefresh(fetchImpl);
    if (refreshed) {
      response = await fetchImpl(url, config);
    }
  }

  if (!response.ok) {
    let errorDetail = `Request failed with status ${response.status}`;
    try {
      const body = await response.json();
      if (body?.detail) {
        errorDetail =
          typeof body.detail === 'string'
            ? body.detail
            : JSON.stringify(body.detail);
      }
    } catch {
      // ignore JSON parse failure
    }
    throw new ApiError(response.status, errorDetail);
  }

  return (await response.json()) as T;
}

export interface OtpRequestResult {
  status: string;
  provider: string;
  expires_in_seconds: number;
  dev_mock_hint?: string | null;
}

export type ConsentType =
  | 'location'
  | 'notifications'
  | 'microphone'
  | 'camera'
  | 'data_processing';

export interface ConsentLedgerEntry {
  id: string;
  user_id: string;
  type: ConsentType;
  granted: boolean;
  source: string;
  created_at: string;
}

export type ConsentStateMap = Record<ConsentType, boolean>;

export interface ConsentsOverview {
  current: ConsentStateMap;
  history: ConsentLedgerEntry[];
}

export interface ContactPermissions {
  receives_sos: boolean;
  receives_checkin: boolean;
  can_see_live_location: boolean;
}

export type ContactStatus = 'invited' | 'accepted' | 'paused' | 'removed';

export interface TrustedContact {
  id: string;
  user_id: string;
  name: string;
  phone_e164: string;
  priority_order: number;
  permissions: ContactPermissions;
  status: ContactStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateContactResponse {
  contact: TrustedContact;
  invitation_token: string;
  invitation_url: string;
  expires_at: string;
}

export interface PublicInvitationDetails {
  inviter_name: string;
  contact_name: string;
  permissions: ContactPermissions;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  expires_at: string;
}

export interface OutboxMessage {
  id: string;
  to_phone_e164: string;
  body: string;
  provider: string;
  purpose: string;
  metadata: {
    contact_id?: string;
    inviter_name?: string;
    contact_name?: string;
    invitation_url?: string;
    token?: string;
    expires_at?: string;
  };
  created_at: string;
}

export const authApi = {
  requestOtp: (phone_e164: string, fetchImpl?: typeof fetch) =>
    apiRequest<OtpRequestResult>(
      '/auth/otp/request',
      {
        method: 'POST',
        body: JSON.stringify({ phone_e164 }),
      },
      fetchImpl
    ),

  verifyOtp: (
    payload: { phone_e164: string; code: string; name?: string },
    fetchImpl?: typeof fetch
  ) =>
    apiRequest<UserProfile>(
      '/auth/otp/verify',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      fetchImpl
    ),

  getMe: (fetchImpl?: typeof fetch) =>
    apiRequest<UserProfile>('/me', { method: 'GET' }, fetchImpl),

  updateMe: (
    payload: { name?: string; language?: 'en' | 'hi' },
    fetchImpl?: typeof fetch
  ) =>
    apiRequest<UserProfile>(
      '/me',
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      },
      fetchImpl
    ),

  logout: (fetchImpl?: typeof fetch) =>
    apiRequest<{ status: string }>(
      '/auth/logout',
      { method: 'POST' },
      fetchImpl
    ),
};

export const consentsApi = {
  getConsents: (fetchImpl?: typeof fetch) =>
    apiRequest<ConsentsOverview>('/consents', { method: 'GET' }, fetchImpl),

  postConsent: (
    payload: { type: ConsentType; granted: boolean; source?: string },
    fetchImpl?: typeof fetch
  ) =>
    apiRequest<{
      entry: ConsentLedgerEntry;
      current: ConsentStateMap;
      history: ConsentLedgerEntry[];
    }>(
      '/consents',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      fetchImpl
    ),
};

export const contactsApi = {
  listContacts: (fetchImpl?: typeof fetch) =>
    apiRequest<{
      contacts: TrustedContact[];
      notifiable_contacts_count?: number;
    }>('/contacts', { method: 'GET' }, fetchImpl),

  createContact: (
    payload: {
      name: string;
      phone_e164: string;
      permissions: ContactPermissions;
    },
    fetchImpl?: typeof fetch
  ) =>
    apiRequest<CreateContactResponse & { notifiable_contacts_count?: number }>(
      '/contacts',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      fetchImpl
    ),

  updateContact: (
    id: string,
    payload: {
      name?: string;
      phone_e164?: string;
      permissions?: ContactPermissions;
    },
    fetchImpl?: typeof fetch
  ) =>
    apiRequest<{ contact: TrustedContact }>(
      `/contacts/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      },
      fetchImpl
    ),

  reorderContacts: (ordered_ids: string[], fetchImpl?: typeof fetch) =>
    apiRequest<{ contacts: TrustedContact[] }>(
      '/contacts/reorder',
      {
        method: 'POST',
        body: JSON.stringify({ ordered_ids }),
      },
      fetchImpl
    ),

  pauseContact: (id: string, fetchImpl?: typeof fetch) =>
    apiRequest<{ contact: TrustedContact }>(
      `/contacts/${id}/pause`,
      { method: 'POST' },
      fetchImpl
    ),

  resumeContact: (id: string, fetchImpl?: typeof fetch) =>
    apiRequest<{ contact: TrustedContact }>(
      `/contacts/${id}/resume`,
      { method: 'POST' },
      fetchImpl
    ),

  removeContact: (id: string, fetchImpl?: typeof fetch) =>
    apiRequest<{ status: string; id: string }>(
      `/contacts/${id}`,
      { method: 'DELETE' },
      fetchImpl
    ),
};

export const invitationsApi = {
  getInvitation: (token: string, fetchImpl?: typeof fetch) =>
    apiRequest<PublicInvitationDetails>(
      `/invitations/${encodeURIComponent(token)}`,
      { method: 'GET' },
      fetchImpl
    ),

  acceptInvitation: (token: string, fetchImpl?: typeof fetch) =>
    apiRequest<{ status: string; contact: TrustedContact }>(
      `/invitations/${encodeURIComponent(token)}/accept`,
      { method: 'POST' },
      fetchImpl
    ),

  declineInvitation: (token: string, fetchImpl?: typeof fetch) =>
    apiRequest<{ status: string }>(
      `/invitations/${encodeURIComponent(token)}/decline`,
      { method: 'POST' },
      fetchImpl
    ),
};

export const devApi = {
  getOutbox: (fetchImpl?: typeof fetch) =>
    apiRequest<{ provider: string; messages: OutboxMessage[] }>(
      '/dev/outbox',
      { method: 'GET' },
      fetchImpl
    ),
};

export type IncidentStatus =
  | 'TRIGGERED'
  | 'CANCELLED'
  | 'ACTIVE'
  | 'NOTIFIED'
  | 'ACKNOWLEDGED'
  | 'RESPONDING'
  | 'ESCALATED'
  | 'RESOLVED'
  | 'FALSE_ALARM'
  | 'EXPIRED';

export interface IncidentEventDto {
  id: string;
  incident_id: string;
  from_status: IncidentStatus | null;
  to_status: IncidentStatus;
  actor_type: 'user' | 'contact' | 'responder' | 'system';
  actor_id: string | null;
  note: string | null;
  created_at: string;
}

export interface LocationSampleDto {
  id: string;
  incident_id: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  captured_at: string;
  expires_at: number;
}

export interface NotificationDto {
  id: string;
  incident_id: string;
  recipient_type: 'contact' | 'responder' | 'gateway_112';
  recipient_ref: string;
  channel: 'push' | 'sms' | 'gateway';
  status: 'queued' | 'sent' | 'delivered' | 'failed';
  attempts: number;
  last_error: string | null;
  created_at: string;
}

export interface IncidentDto {
  id: string;
  user_id: string;
  status: IncidentStatus;
  emergency_type: string | null;
  client_request_id: string;
  created_at: string;
  activated_at: string | null;
  closed_at: string | null;
  merged_into_id: string | null;
  source_trigger: string;
  is_duress: boolean;
  needs_user_action: boolean;
  escalation_stage: number;
  auto_expire_minutes?: number;
  notifiable_contacts_count?: number;
  events?: IncidentEventDto[];
  locations?: LocationSampleDto[];
  notifications?: NotificationDto[];
}

export interface CreateIncidentResponse {
  incident: IncidentDto;
  idempotent_replay: boolean;
  merged_into_existing: boolean;
  notifiable_contacts_count?: number;
}

export const incidentsApi = {
  createIncident: (
    payload: {
      client_request_id: string;
      client_created_at?: string;
      source_trigger?: string;
      emergency_type?: string | null;
      location?: {
        lat: number;
        lng: number;
        accuracy_m?: number | null;
        captured_at?: string;
      };
    },
    fetchImpl?: typeof fetch
  ) =>
    apiRequest<CreateIncidentResponse>(
      '/incidents',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      fetchImpl
    ),

  getActiveIncident: (fetchImpl?: typeof fetch) =>
    apiRequest<{
      incident: IncidentDto | null;
      notifiable_contacts_count: number;
    }>('/incidents/active', { method: 'GET' }, fetchImpl),

  getIncident: (id: string, fetchImpl?: typeof fetch) =>
    apiRequest<{
      incident: IncidentDto;
      notifiable_contacts_count: number;
    }>(`/incidents/${encodeURIComponent(id)}`, { method: 'GET' }, fetchImpl),

  cancelIncident: (
    id: string,
    payload: { pin?: string; note?: string } = {},
    fetchImpl?: typeof fetch
  ) =>
    apiRequest<{
      status: string;
      incident: IncidentDto;
      notifiable_contacts_count: number;
      _duress_keep_location_active?: boolean;
    }>(
      `/incidents/${encodeURIComponent(id)}/cancel`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      fetchImpl
    ),

  addLocationSample: (
    id: string,
    payload: {
      lat: number;
      lng: number;
      accuracy_m?: number | null;
      captured_at?: string;
    },
    fetchImpl?: typeof fetch
  ) =>
    apiRequest<{ location: LocationSampleDto }>(
      `/incidents/${encodeURIComponent(id)}/location`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      fetchImpl
    ),

  setEmergencyType: (
    id: string,
    emergency_type: string,
    fetchImpl?: typeof fetch
  ) =>
    apiRequest<{ incident: IncidentDto }>(
      `/incidents/${encodeURIComponent(id)}/type`,
      {
        method: 'POST',
        body: JSON.stringify({ emergency_type }),
      },
      fetchImpl
    ),

  resolveIncident: (
    id: string,
    payload: { resolution?: 'RESOLVED' | 'FALSE_ALARM'; note?: string } = {
      resolution: 'RESOLVED',
    },
    fetchImpl?: typeof fetch
  ) =>
    apiRequest<{ incident: IncidentDto }>(
      `/incidents/${encodeURIComponent(id)}/resolve`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      fetchImpl
    ),
};

export const settingsApi = {
  updateCancelWindow: (
    cancel_window_seconds: number,
    fetchImpl?: typeof fetch
  ) =>
    apiRequest<{ cancel_window_seconds: number }>(
      '/settings/cancel-window',
      {
        method: 'PUT',
        body: JSON.stringify({ cancel_window_seconds }),
      },
      fetchImpl
    ),

  updateCancelPin: (pin: string | null, fetchImpl?: typeof fetch) =>
    apiRequest<{ cancel_pin_configured: boolean }>(
      '/settings/cancel-pin',
      {
        method: 'PUT',
        body: JSON.stringify({ pin }),
      },
      fetchImpl
    ),

  updateDuressPin: (
    payload: { pin: string | null; cancel_pin?: string | null },
    fetchImpl?: typeof fetch
  ) =>
    apiRequest<{
      duress_pin_configured: boolean;
      cancel_pin_configured?: boolean;
    }>(
      '/settings/duress-pin',
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      fetchImpl
    ),
};
