import { UserProfile } from '../store/authStore';
import {
  getActivePrototypeRole,
  handleStandaloneApkApiRequest,
  isPrototypeZeroAuthMode,
  isStandaloneAndroidApk,
} from './standaloneApkApi';
import {
  getServerConfig,
  resolveEffectiveApiBaseUrl,
} from './serverConfig';

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
  const apiBase = resolveEffectiveApiBaseUrl();
  refreshPromise = (async () => {
    try {
      const res = await fetchImpl(`${apiBase}/auth/refresh`, {
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
  const srvCfg = getServerConfig();
  if (
    srvCfg.mode === 'standalone' ||
    (isStandaloneAndroidApk() && !srvCfg.remoteServerUrl)
  ) {
    return handleStandaloneApkApiRequest<T>(path, options);
  }

  // Only attach X-Demo-Role in local/preview zero-auth demo mode when no custom remote production server URL is configured
  const hasCustomRemoteServer = Boolean(srvCfg.remoteServerUrl);
  const zeroAuthDemo = !hasCustomRemoteServer && isPrototypeZeroAuthMode();
  const demoRoleHeader: Record<string, string> = zeroAuthDemo
    ? { 'X-Demo-Role': getActivePrototypeRole() }
    : {};

  const apiBase = resolveEffectiveApiBaseUrl();
  const url = `${apiBase}${path}`;
  const config: RequestInit = {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...demoRoleHeader,
      ...(options.headers || {}),
    },
  };

  let response: Response;
  try {
    response = await fetchImpl(url, config);
  } catch (err) {
    if (zeroAuthDemo) {
      return handleStandaloneApkApiRequest<T>(path, options);
    }
    throw err;
  }

  // Automatic token refresh on 401 (except when calling auth or public invitation/contact endpoints)
  if (
    response.status === 401 &&
    !path.startsWith('/auth/otp') &&
    !path.startsWith('/invitations/') &&
    !path.startsWith('/c/') &&
    path !== '/auth/refresh'
  ) {
    const refreshed = await attemptTokenRefresh(fetchImpl);
    if (refreshed) {
      response = await fetchImpl(url, config);
    }
  }

  if (!response.ok) {
    // Only fall back to local prototype handler when zeroAuthDemo is active (never silently downgrade 401/403 on a configured remote server)
    if (
      zeroAuthDemo &&
      (response.status === 401 ||
        response.status === 403 ||
        (response.status === 404 && path.startsWith('/demo/')))
    ) {
      return handleStandaloneApkApiRequest<T>(path, options);
    }

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
    incident_id?: string;
    contact_id?: string;
    inviter_name?: string;
    contact_name?: string;
    invitation_url?: string;
    contact_url?: string;
    token?: string;
    expires_at?: string;
  };
  created_at: string;
}

export type ContactResponseAction =
  | 'seen'
  | 'calling_her'
  | 'on_my_way'
  | 'cannot_help'
  | 'confirm_safe';

export interface ContactIncidentSummaryDto {
  incident_id: string;
  user_first_name: string;
  user_phone_e164: string;
  contact_id: string;
  contact_name: string;
  triggered_at: string;
  activated_at: string | null;
  emergency_type: string | null;
  status: IncidentStatus;
  is_duress: boolean;
  duress_notice: string | null;
  can_see_live_location: boolean;
  location_freshness_seconds: number | null;
  location?: {
    lat: number;
    lng: number;
    accuracy_m: number | null;
    captured_at: string;
  };
}

export interface ContactRespondResultDto {
  action: ContactResponseAction;
  incident_status: IncidentStatus;
  closed: boolean;
  summary: ContactIncidentSummaryDto | null;
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
    payload: {
      name?: string;
      language?: 'en' | 'hi';
      organization_zone?: string;
    },
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

  exportMyData: (fetchImpl?: typeof fetch) =>
    apiRequest<Record<string, unknown>>(
      '/me/export',
      { method: 'GET' },
      fetchImpl
    ),

  deleteMyAccount: (
    payload: {
      confirmation: string;
      otp_code: string;
    },
    fetchImpl?: typeof fetch
  ) =>
    apiRequest<{ status: 'account_deleted' }>(
      '/me',
      {
        method: 'DELETE',
        body: JSON.stringify(payload),
      },
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

export const contactMagicApi = {
  getSummary: (token: string, fetchImpl?: typeof fetch) =>
    apiRequest<ContactIncidentSummaryDto>(
      `/c/${encodeURIComponent(token)}`,
      { method: 'GET' },
      fetchImpl
    ),

  respond: (
    token: string,
    payload: { action: ContactResponseAction; note?: string },
    fetchImpl?: typeof fetch
  ) =>
    apiRequest<ContactRespondResultDto>(
      `/c/${encodeURIComponent(token)}/respond`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
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

  submitRating: (id: string, score: number, fetchImpl?: typeof fetch) =>
    apiRequest<{
      rating: { incident_id: string; score: number; created_at: string };
    }>(
      `/incidents/${encodeURIComponent(id)}/rating`,
      {
        method: 'POST',
        body: JSON.stringify({ score }),
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

export interface ResponderProfileDto {
  id: string;
  user_id: string;
  name: string;
  phone_e164: string;
  organization_zone: string;
  active: boolean;
  on_duty: boolean;
}

export interface ResponderIncidentListItemDto {
  id: string;
  user_first_name: string;
  organization_zone: string;
  status: IncidentStatus;
  emergency_type: string | null;
  source_trigger: string;
  is_duress: boolean;
  duress_notice: string | null;
  created_at: string;
  activated_at: string | null;
  closed_at: string | null;
  acknowledged_by_responder: boolean;
  assigned_responder_user_ids: string[];
  latest_location: {
    lat: number;
    lng: number;
    accuracy_m: number | null;
    captured_at: string;
  } | null;
}

export interface ResponderIncidentDetailDto
  extends ResponderIncidentListItemDto {
  user_phone_e164: string | null;
  mock_112_gateway?: {
    is_mock: true;
    label: 'MOCK';
    provider: string;
    status: string;
    reference_id: string | null;
  };
  events: IncidentEventDto[];
  assignments: Array<{
    id: string;
    responder_id: string;
    responder_user_id: string;
    organization_zone: string;
    assigned_by_user_id: string | null;
    acknowledged_at: string | null;
    created_at: string;
  }>;
}

export type ResponderActionType =
  | 'acknowledge'
  | 'assign'
  | 'note'
  | 'responding'
  | 'resolve'
  | 'false-alarm';

export const responderApi = {
  listIncidents: (fetchImpl?: typeof fetch) =>
    apiRequest<{
      responder: ResponderProfileDto;
      colleagues: ResponderProfileDto[];
      incidents: ResponderIncidentListItemDto[];
    }>('/responder/incidents', { method: 'GET' }, fetchImpl),

  getIncidentDetail: (id: string, fetchImpl?: typeof fetch) =>
    apiRequest<{ incident: ResponderIncidentDetailDto }>(
      `/responder/incidents/${encodeURIComponent(id)}`,
      { method: 'GET' },
      fetchImpl
    ),

  performAction: (
    id: string,
    action: ResponderActionType,
    payload: { note?: string; target_responder_user_id?: string } = {},
    fetchImpl?: typeof fetch
  ) =>
    apiRequest<{ incident: ResponderIncidentDetailDto }>(
      `/responder/incidents/${encodeURIComponent(id)}/${action}`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      fetchImpl
    ),
};

export interface IncidentAccessAuditDto {
  id: string;
  incident_id: string;
  actor_type: 'contact' | 'responder' | 'admin';
  actor_id: string;
  actor_label: string | null;
  action: string;
  detail: string | null;
  created_at: string;
}

export const adminAuditApi = {
  listAuditLogs: (
    incidentId?: string,
    actorType?: 'contact' | 'responder' | 'admin',
    fetchImpl?: typeof fetch
  ) => {
    const sp = new URLSearchParams();
    if (incidentId) sp.set('incident_id', incidentId);
    if (actorType) sp.set('actor_type', actorType);
    const qs = sp.toString();
    return apiRequest<{ entries: IncidentAccessAuditDto[] }>(
      qs ? `/admin/audit-logs?${qs}` : '/admin/audit-logs',
      { method: 'GET' },
      fetchImpl
    );
  },
};

export interface MetricEntryDto {
  metric: string;
  value: number | null;
  n: number;
  target: string | null;
  formula: string;
  insufficient_data: boolean;
  unit?: string;
  informational?: boolean;
  environment_label?: string;
  excluded_implausible?: number;
  queued_then_delivered?: {
    label: string;
    n: number;
    value: number | null;
    insufficient_data: boolean;
  };
  by_channel?: Record<
    string,
    {
      n: number;
      succeeded: number;
      value: number | null;
      rate_percent: number | null;
      insufficient_data: boolean;
    }
  >;
  median_seconds?: number | null;
  p90_seconds?: number | null;
  cancelled_count?: number;
  false_alarm_count?: number;
  active_with_location_count?: number;
  median_accuracy_meters?: number | null;
  location_consent_off_count?: number;
  valid_chain_count?: number;
  average_score?: number | null;
  avoided_going_somewhere_percent?: number | null;
  by_week?: Array<{
    week: string;
    week_start: string;
    n: number;
    value: number | null;
    average_score: number | null;
    avoided_going_somewhere_percent: number | null;
    insufficient_data: boolean;
  }>;
}

export interface ImpactMetricsResponseDto {
  range: {
    from: string;
    to: string;
  };
  minimum_sample_size: number;
  includes_demo_data?: boolean;
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

export interface AdminResponderDto {
  id: string;
  name: string;
  organization_zone: string;
  active: boolean;
  on_duty: boolean;
}

export const adminMetricsApi = {
  getMetrics: (
    params?: { from?: string; to?: string },
    fetchImpl?: typeof fetch
  ) => {
    const sp = new URLSearchParams();
    if (params?.from) sp.set('from', params.from);
    if (params?.to) sp.set('to', params.to);
    const qs = sp.toString();
    return apiRequest<ImpactMetricsResponseDto>(
      qs ? `/admin/metrics?${qs}` : '/admin/metrics',
      { method: 'GET' },
      fetchImpl
    );
  },

  getMetricsCsvUrl: (params?: { from?: string; to?: string }) => {
    const sp = new URLSearchParams();
    if (params?.from) sp.set('from', params.from);
    if (params?.to) sp.set('to', params.to);
    const qs = sp.toString();
    const apiBase = resolveEffectiveApiBaseUrl();
    return qs ? `${apiBase}/admin/metrics.csv?${qs}` : `${apiBase}/admin/metrics.csv`;
  },

  downloadMetricsCsvText: async (
    params?: { from?: string; to?: string },
    fetchImpl: typeof fetch = fetch
  ): Promise<string> => {
    const zeroAuth = isPrototypeZeroAuthMode();
    if (!isStandaloneAndroidApk()) {
      try {
        const url = adminMetricsApi.getMetricsCsvUrl(params);
        const res = await fetchImpl(url, {
          method: 'GET',
          credentials: 'include',
          headers: zeroAuth ? { 'X-Demo-Role': 'admin' } : undefined,
        });
        if (res.ok) {
          return res.text();
        }
        if (!zeroAuth) {
          throw new ApiError(res.status, 'Failed to download CSV');
        }
      } catch (err) {
        if (!zeroAuth) throw err;
      }
    }
    const data = await adminMetricsApi.getMetrics(params, fetchImpl);
    const rows = [
      'metric,value,n,target,formula,insufficient_data',
      ...Object.values(data.metrics).map(
        (m) =>
          `"${m.metric}",${m.value ?? ''},${m.n},"${m.target ?? ''}","${m.formula}",${m.insufficient_data}`
      ),
    ];
    return rows.join('\n');
  },
};

export const adminRespondersApi = {
  listResponders: (fetchImpl?: typeof fetch) =>
    apiRequest<{ responders: AdminResponderDto[] }>(
      '/admin/responders',
      { method: 'GET' },
      fetchImpl
    ),

  updateResponder: (
    id: string,
    payload: { active?: boolean; on_duty?: boolean },
    fetchImpl?: typeof fetch
  ) =>
    apiRequest<{ responder: AdminResponderDto; warning: string | null }>(
      `/admin/responders/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      },
      fetchImpl
    ),
};

export type JourneyStatus = 'active' | 'completed' | 'lapsed' | 'cancelled';

export interface JourneyDto {
  id: string;
  user_id: string;
  contact_id: string | null;
  contact_name: string | null;
  started_at: string;
  ends_at: string;
  status: JourneyStatus;
  reminder_sent_at: string | null;
  lapsed_notified_at: string | null;
  note?: string | null;
}

export const journeysApi = {
  getActive: (fetchImpl?: typeof fetch) =>
    apiRequest<{ journey: JourneyDto | null }>(
      '/journeys/active',
      { method: 'GET' },
      fetchImpl
    ),

  start: (
    payload: {
      duration_minutes: number;
      contact_id?: string | null;
      note?: string | null;
    },
    fetchImpl?: typeof fetch
  ) =>
    apiRequest<{ journey: JourneyDto }>(
      '/journeys',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      fetchImpl
    ),

  extend: (
    id: string,
    additional_minutes: number = 10,
    fetchImpl?: typeof fetch
  ) =>
    apiRequest<{ journey: JourneyDto }>(
      `/journeys/${encodeURIComponent(id)}/extend`,
      {
        method: 'POST',
        body: JSON.stringify({ additional_minutes }),
      },
      fetchImpl
    ),

  complete: (id: string, fetchImpl?: typeof fetch) =>
    apiRequest<{ journey: JourneyDto }>(
      `/journeys/${encodeURIComponent(id)}/complete`,
      { method: 'POST' },
      fetchImpl
    ),

  cancel: (id: string, fetchImpl?: typeof fetch) =>
    apiRequest<{ journey: JourneyDto }>(
      `/journeys/${encodeURIComponent(id)}/cancel`,
      { method: 'POST' },
      fetchImpl
    ),
};

export type ReportCategory =
  | 'poor_lighting'
  | 'harassment'
  | 'stalking'
  | 'unsafe_area'
  | 'broken_cctv'
  | 'other';

export interface CreatedReportReceiptDto {
  id: string;
  category: ReportCategory;
  lat: number;
  lng: number;
  anonymous: boolean;
  created_at: string;
}

export interface SafetyLayerCellDto {
  cell_id: string;
  lat: number;
  lng: number;
  total_count: number;
  categories: Record<string, number>;
  last_reported_at: string;
}

export interface SafetyLayerResponseDto {
  k_threshold: number;
  cell_precision_decimals: 3;
  approx_cell_size_meters: 110;
  cells: SafetyLayerCellDto[];
}

export const reportsApi = {
  createReport: (
    payload: {
      category: ReportCategory;
      lat: number;
      lng: number;
      note?: string | null;
      anonymous?: boolean;
    },
    fetchImpl?: typeof fetch
  ) =>
    apiRequest<{ report: CreatedReportReceiptDto }>(
      '/reports',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      fetchImpl
    ),

  getSafetyLayer: (fetchImpl?: typeof fetch) =>
    apiRequest<SafetyLayerResponseDto>(
      '/safety-layer',
      { method: 'GET' },
      fetchImpl
    ),
};

export interface ResourceDto {
  id: string;
  name: string;
  category: string;
  phone: string;
  description: string;
  available_hours: string;
  active: boolean;
}

export interface SafetyPulseStatusDto {
  should_prompt: boolean;
  last_submitted_at: string | null;
  next_eligible_at: string | null;
}

export interface SubmittedPulseDto {
  id: string;
  safety_score: number;
  avoided_going_somewhere: boolean;
  anonymous: boolean;
  created_at: string;
}

export const resourcesPulseApi = {
  listResources: (
    params?: { q?: string; category?: string },
    fetchImpl?: typeof fetch
  ) => {
    const searchParams = new URLSearchParams();
    if (params?.q) searchParams.set('q', params.q);
    if (params?.category && params.category !== 'all') {
      searchParams.set('category', params.category);
    }
    const qs = searchParams.toString();
    return apiRequest<{ resources: ResourceDto[] }>(
      qs ? `/resources?${qs}` : '/resources',
      { method: 'GET' },
      fetchImpl
    );
  },

  createResource: (
    payload: {
      name: string;
      category: string;
      phone: string;
      description: string;
      available_hours: string;
      active?: boolean;
    },
    fetchImpl?: typeof fetch
  ) =>
    apiRequest<{ resource: ResourceDto }>(
      '/admin/resources',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      fetchImpl
    ),

  updateResource: (
    id: string,
    payload: Partial<{
      name: string;
      category: string;
      phone: string;
      description: string;
      available_hours: string;
      active: boolean;
    }>,
    fetchImpl?: typeof fetch
  ) =>
    apiRequest<{ resource: ResourceDto }>(
      `/admin/resources/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      fetchImpl
    ),

  deleteResource: (id: string, fetchImpl?: typeof fetch) =>
    apiRequest<{ deleted_id: string }>(
      `/admin/resources/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      fetchImpl
    ),

  getPulseStatus: (fetchImpl?: typeof fetch) =>
    apiRequest<SafetyPulseStatusDto>(
      '/pulse/status',
      { method: 'GET' },
      fetchImpl
    ),

  submitPulse: (
    payload: {
      safety_score: number;
      avoided_going_somewhere: boolean;
      anonymous?: boolean;
    },
    fetchImpl?: typeof fetch
  ) =>
    apiRequest<{ pulse: SubmittedPulseDto }>(
      '/pulse',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      fetchImpl
    ),
};

export interface DemoStatusDto {
  demo_mode: true;
  banner: string;
  providers: {
    sms: { name: string; label: 'MOCK' };
    push: { name: string; label: 'MOCK' };
    gateway_112: { name: string; label: 'MOCK' };
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

export const demoApi = {
  getStatus: (fetchImpl?: typeof fetch) =>
    apiRequest<DemoStatusDto>('/demo/status', { method: 'GET' }, fetchImpl),

  resetDemoData: (fetchImpl?: typeof fetch) =>
    apiRequest<DemoResetResultDto>(
      '/demo/reset',
      { method: 'POST' },
      fetchImpl
    ),

  simulateResponder: (
    payload: {
      incident_id?: string;
      action: 'acknowledge' | 'responding' | 'resolve';
      delay_ms?: number;
      note?: string;
    },
    fetchImpl?: typeof fetch
  ) =>
    apiRequest<{
      simulated: true;
      actor_type: 'responder';
      action: string;
      incident_id: string;
      incident_status: IncidentStatus;
      incident: ResponderIncidentDetailDto;
    }>(
      '/demo/simulate/responder',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      fetchImpl
    ),

  simulateContact: (
    payload: {
      incident_id?: string;
      action: 'seen' | 'on_my_way';
      contact_id?: string;
      delay_ms?: number;
      note?: string;
    },
    fetchImpl?: typeof fetch
  ) =>
    apiRequest<{
      simulated: true;
      actor_type: 'contact';
      contact_id: string;
      contact_name: string;
      action: string;
      incident_id: string;
      incident_status: IncidentStatus;
      summary: ContactIncidentSummaryDto | null;
    }>(
      '/demo/simulate/contact',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      fetchImpl
    ),
};

export interface SafetyToolDto {
  id: string;
  category: string;
  title: string;
  description: string;
  safe_use_notes: string;
  legal_note: string;
  link_url: string | null;
  link_label: string;
  last_checked: string;
  active: boolean;
  is_affiliate: boolean;
}

export const safetyToolsApi = {
  listSafetyTools: (
    params?: { category?: string; include_inactive?: boolean },
    fetchImpl?: typeof fetch
  ) => {
    const searchParams = new URLSearchParams();
    if (params?.category && params.category !== 'all') {
      searchParams.set('category', params.category);
    }
    if (params?.include_inactive) {
      searchParams.set('include_inactive', 'true');
    }
    const qs = searchParams.toString();
    return apiRequest<{ safety_tools: SafetyToolDto[] }>(
      qs ? `/safety-tools?${qs}` : '/safety-tools',
      { method: 'GET' },
      fetchImpl
    );
  },

  createSafetyTool: (
    payload: {
      category: string;
      title: string;
      description: string;
      safe_use_notes: string;
      legal_note: string;
      link_url?: string | null;
      link_label?: string;
      last_checked?: string;
      active?: boolean;
      is_affiliate?: boolean;
    },
    fetchImpl?: typeof fetch
  ) =>
    apiRequest<{ safety_tool: SafetyToolDto }>(
      '/admin/safety-tools',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      fetchImpl
    ),

  updateSafetyTool: (
    id: string,
    payload: Partial<{
      category: string;
      title: string;
      description: string;
      safe_use_notes: string;
      legal_note: string;
      link_url: string | null;
      link_label: string;
      last_checked: string;
      active: boolean;
      is_affiliate: boolean;
    }>,
    fetchImpl?: typeof fetch
  ) =>
    apiRequest<{ safety_tool: SafetyToolDto }>(
      `/admin/safety-tools/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      fetchImpl
    ),

  deleteSafetyTool: (id: string, fetchImpl?: typeof fetch) =>
    apiRequest<{ success: boolean; deleted_id: string }>(
      `/admin/safety-tools/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      },
      fetchImpl
    ),
};




