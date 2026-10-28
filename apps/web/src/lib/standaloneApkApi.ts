import type { UserProfile } from '../store/authStore';
import { OFFLINE_LOCAL_RESOURCES } from '../pages/ResourcesPage';
import { OFFLINE_DEFAULT_SAFETY_TOOLS } from '../pages/SafetyToolsPage';
import type {
  AdminResponderDto,
  ConsentLedgerEntry,
  ConsentStateMap,
  ConsentType,
  ContactIncidentSummaryDto,
  ContactResponseAction,
  IncidentAccessAuditDto,
  IncidentDto,
  IncidentStatus,
  ImpactMetricsResponseDto,
  JourneyDto,
  OutboxMessage,
  ReportCategory,
  ResourceDto,
  ResponderIncidentDetailDto,
  ResponderProfileDto,
  SafetyLayerCellDto,
  SafetyToolDto,
  TrustedContact,
} from './api';

export function isStandaloneAndroidApk(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  const ua = navigator.userAgent || '';
  if (/ShaktiAndroidApk/i.test(ua)) {
    return true;
  }
  // Also detect Android WebView serving bundled https://localhost without a port
  if (
    window.location?.hostname === 'localhost' &&
    !window.location?.port &&
    /; wv\)|Version\/\d+\.\d+ Chrome\//i.test(ua)
  ) {
    return true;
  }
  return false;
}

const STORAGE_KEY = 'shakti_standalone_apk_state_v1';

interface StandaloneState {
  currentUserPhone: string | null;
  users: Record<string, UserProfile>;
  consents: Record<string, ConsentStateMap>;
  consentHistory: Record<string, ConsentLedgerEntry[]>;
  contacts: TrustedContact[];
  outbox: OutboxMessage[];
  incidents: IncidentDto[];
  journeys: JourneyDto[];
  reportsCells: SafetyLayerCellDto[];
  resources: ResourceDto[];
  safetyTools: SafetyToolDto[];
  responders: ResponderProfileDto[];
  auditLogs: IncidentAccessAuditDto[];
  lastPulseAt: string | null;
}

function createInitialState(): StandaloneState {
  const now = new Date().toISOString();
  const demoUser: UserProfile = {
    id: 'usr_demo_1',
    phone_e164: '+919000000001',
    name: 'Aarohi Sharma',
    role: 'user',
    language: 'en',
    organization_zone: 'North Campus Zone',
    cancel_window_seconds: 5,
    has_cancel_pin: false,
    has_duress_pin: false,
    created_at: now,
  };
  const demoResponder: UserProfile = {
    id: 'usr_demo_2',
    phone_e164: '+919000000002',
    name: 'Inspector Kavita Rao',
    role: 'responder',
    language: 'en',
    organization_zone: 'North Campus Zone',
    cancel_window_seconds: 5,
    has_cancel_pin: false,
    has_duress_pin: false,
    created_at: now,
  };
  const demoAdmin: UserProfile = {
    id: 'usr_demo_3',
    phone_e164: '+919000000003',
    name: 'Meera Nair (Admin)',
    role: 'admin',
    language: 'en',
    organization_zone: 'North Campus Zone',
    cancel_window_seconds: 5,
    has_cancel_pin: false,
    has_duress_pin: false,
    created_at: now,
  };

  const defaultConsents: ConsentStateMap = {
    data_processing: true,
    location: true,
    notifications: true,
    microphone: false,
    camera: false,
  };

  const defaultHistory: ConsentLedgerEntry[] = [
    {
      id: 'c_seed_1',
      user_id: demoUser.id,
      type: 'data_processing',
      granted: true,
      source: 'onboarding',
      created_at: now,
    },
    {
      id: 'c_seed_2',
      user_id: demoUser.id,
      type: 'location',
      granted: true,
      source: 'consent_center',
      created_at: now,
    },
    {
      id: 'c_seed_3',
      user_id: demoUser.id,
      type: 'notifications',
      granted: true,
      source: 'consent_center',
      created_at: now,
    },
  ];

  const seededContacts: TrustedContact[] = [
    {
      id: 'ct_seed_1',
      user_id: demoUser.id,
      name: 'Priya Verma (Sister)',
      phone_e164: '+919876543210',
      priority_order: 1,
      status: 'accepted',
      permissions: {
        receives_sos: true,
        receives_checkin: true,
        can_see_live_location: true,
      },
      created_at: now,
      updated_at: now,
    },
    {
      id: 'ct_seed_2',
      user_id: demoUser.id,
      name: 'Ananya Gupta (Roommate)',
      phone_e164: '+919876543211',
      priority_order: 2,
      status: 'accepted',
      permissions: {
        receives_sos: true,
        receives_checkin: true,
        can_see_live_location: true,
      },
      created_at: now,
      updated_at: now,
    },
  ];

  const seededResources: ResourceDto[] = [
    ...OFFLINE_LOCAL_RESOURCES,
    {
      id: 'res_osc_1',
      name: 'Sakhi One Stop Centre (24x7 Crisis Support)',
      category: 'one_stop_centre',
      phone: '181',
      description:
        'Integrated medical, legal, psychological counseling, and temporary shelter support for women.',
      available_hours: '24x7',
      active: true,
    },
    {
      id: 'res_campus_1',
      name: 'Campus Women Safety Patrol & Control Room',
      category: 'campus_security',
      phone: '+911127667000',
      description:
        '24x7 campus security escort and rapid response team for North Campus Zone.',
      available_hours: '24x7',
      active: true,
    },
    {
      id: 'res_legal_1',
      name: 'NALSA Free Legal Aid Helpline',
      category: 'legal_aid',
      phone: '15100',
      description:
        'National Legal Services Authority toll-free legal assistance and rights guidance.',
      available_hours: '24x7',
      active: true,
    },
    {
      id: 'res_counsel_1',
      name: 'NIMHANS Psychosocial & Trauma Support Line',
      category: 'counseling',
      phone: '08046110007',
      description:
        'Confidential trauma-informed counseling and mental health support.',
      available_hours: '24x7',
      active: true,
    },
  ];

  const seededCells: SafetyLayerCellDto[] = [
    {
      cell_id: '28.614_77.209',
      lat: 28.614,
      lng: 77.209,
      total_count: 7,
      categories: { poor_lighting: 5, unsafe_area: 2 },
      last_reported_at: now,
    },
    {
      cell_id: '28.688_77.210',
      lat: 28.688,
      lng: 77.21,
      total_count: 6,
      categories: { broken_cctv: 4, poor_lighting: 2 },
      last_reported_at: now,
    },
  ];

  const seededResponders: ResponderProfileDto[] = [
    {
      id: 'resp_1',
      user_id: demoResponder.id,
      name: 'Inspector Kavita Rao',
      phone_e164: '+919000000002',
      organization_zone: 'North Campus Zone',
      active: true,
      on_duty: true,
    },
    {
      id: 'resp_2',
      user_id: 'usr_resp_2',
      name: 'Sub-Inspector Ritu Sharma',
      phone_e164: '+919000000004',
      organization_zone: 'North Campus Zone',
      active: true,
      on_duty: true,
    },
  ];

  return {
    currentUserPhone: '+919000000001',
    users: {
      '+919000000001': demoUser,
      '+919000000002': demoResponder,
      '+919000000003': demoAdmin,
    },
    consents: {
      [demoUser.id]: defaultConsents,
      [demoResponder.id]: { ...defaultConsents },
      [demoAdmin.id]: { ...defaultConsents },
    },
    consentHistory: {
      [demoUser.id]: defaultHistory,
      [demoResponder.id]: [],
      [demoAdmin.id]: [],
    },
    contacts: seededContacts,
    outbox: [],
    incidents: [],
    journeys: [],
    reportsCells: seededCells,
    resources: seededResources,
    safetyTools: [...OFFLINE_DEFAULT_SAFETY_TOOLS],
    responders: seededResponders,
    auditLogs: [
      {
        id: 'aud_seed_1',
        incident_id: 'inc_demo_hist_1',
        actor_type: 'responder',
        actor_id: demoResponder.id,
        actor_label: 'Inspector Kavita Rao',
        action: 'ACKNOWLEDGE_INCIDENT',
        detail: 'Responder acknowledged campus SOS dispatch within 18s',
        created_at: now,
      },
    ],
    lastPulseAt: null,
  };
}

function loadState(): StandaloneState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StandaloneState;
      // If user previously got logged out or state was empty, ensure a default user is active for hackathon prototype
      if (!parsed.users) {
        return createInitialState();
      }
      return parsed;
    }
  } catch {
    // ignore
  }
  const initial = createInitialState();
  saveState(initial);
  return initial;
}

function saveState(state: StandaloneState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function switchStandalonePrototypeRole(
  role: 'user' | 'responder' | 'admin'
): UserProfile {
  const state = loadState();
  const phone =
    role === 'responder'
      ? '+919000000002'
      : role === 'admin'
        ? '+919000000003'
        : '+919000000001';
  state.currentUserPhone = phone;
  saveState(state);
  return state.users[phone];
}

function getCurrentUser(state: StandaloneState): UserProfile {
  const phone = state.currentUserPhone || '+919000000001';
  return (
    state.users[phone] ||
    state.users['+919000000001'] ||
    createInitialState().users['+919000000001']
  );
}

function getNotifiableCount(state: StandaloneState): number {
  return state.contacts.filter(
    (c) => c.status === 'accepted' && c.permissions.receives_sos
  ).length;
}

function getActiveIncidentFromState(state: StandaloneState): IncidentDto | null {
  const openStatuses: IncidentStatus[] = [
    'TRIGGERED',
    'ACTIVE',
    'NOTIFIED',
    'ACKNOWLEDGED',
    'RESPONDING',
    'ESCALATED',
  ];
  return (
    state.incidents.find((inc) => openStatuses.includes(inc.status)) || null
  );
}

export async function handleStandaloneApkApiRequest<T>(
  rawPath: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const [pathname, queryString] = rawPath.split('?');
  const searchParams = new URLSearchParams(queryString || '');
  const body =
    options.body && typeof options.body === 'string'
      ? JSON.parse(options.body)
      : {};

  const state = loadState();
  const user = getCurrentUser(state);
  const now = new Date().toISOString();

  // 1. Demo status & reset
  if (pathname === '/demo/status' && method === 'GET') {
    return {
      demo_mode: true,
      banner: 'PROTOTYPE DEMO MODE: All features unlocked locally on device',
      providers: {
        sms: { name: 'MockSmsProvider', label: 'MOCK' },
        push: { name: 'MockPushProvider', label: 'MOCK' },
        gateway_112: { name: 'MockEmergencyGateway', label: 'MOCK' },
      },
    } as unknown as T;
  }

  if (pathname === '/demo/reset' && method === 'POST') {
    const fresh = createInitialState();
    saveState(fresh);
    return {
      status: 'demo_reset_complete',
      seeded: {
        users: 3,
        accepted_contacts: 2,
        responders: 2,
        resources: fresh.resources.length,
        demo_incidents: 0,
        demo_reports: 2,
        demo_safety_pulses: 5,
      },
    } as unknown as T;
  }

  // 2. Auth & Profile (/me, /auth/*)
  if (pathname === '/me' && method === 'GET') {
    if (!state.currentUserPhone) {
      state.currentUserPhone = '+919000000001';
      saveState(state);
    }
    return getCurrentUser(state) as unknown as T;
  }

  if (pathname === '/me' && method === 'PATCH') {
    const updated: UserProfile = {
      ...user,
      ...(body.name ? { name: body.name } : {}),
      ...(body.language ? { language: body.language } : {}),
      ...(body.organization_zone
        ? { organization_zone: body.organization_zone }
        : {}),
    };
    state.users[user.phone_e164] = updated;
    saveState(state);
    return updated as unknown as T;
  }

  if (pathname === '/me/export' && method === 'GET') {
    return {
      exported_at: now,
      user,
      consents: state.consents[user.id] || {},
      contacts: state.contacts,
      incidents: state.incidents,
      journeys: state.journeys,
    } as unknown as T;
  }

  if (pathname === '/me' && method === 'DELETE') {
    const fresh = createInitialState();
    saveState(fresh);
    return { status: 'account_deleted' } as unknown as T;
  }

  if (pathname === '/auth/otp/request' && method === 'POST') {
    return {
      status: 'sent',
      provider: 'MockOtpProvider',
      expires_in_seconds: 300,
      dev_mock_hint: '123456',
    } as unknown as T;
  }

  if (pathname === '/auth/otp/verify' && method === 'POST') {
    const phone = (body.phone_e164 || '+919000000001').trim();
    if (!state.users[phone]) {
      state.users[phone] = {
        id: `usr_${Date.now()}`,
        phone_e164: phone,
        name: body.name?.trim() || 'Prototype User',
        role: 'user',
        language: 'en',
        organization_zone: 'North Campus Zone',
        cancel_window_seconds: 5,
        has_cancel_pin: false,
        has_duress_pin: false,
        created_at: now,
      };
      state.consents[state.users[phone].id] = {
        data_processing: true,
        location: true,
        notifications: true,
        microphone: false,
        camera: false,
      };
      state.consentHistory[state.users[phone].id] = [];
    } else if (body.name?.trim()) {
      state.users[phone].name = body.name.trim();
    }
    state.currentUserPhone = phone;
    saveState(state);
    return state.users[phone] as unknown as T;
  }

  if (pathname === '/auth/logout' && method === 'POST') {
    // Keep prototype signed in as default demo user so hackathon demo never gets stuck on AccountRequiredPage
    state.currentUserPhone = '+919000000001';
    saveState(state);
    return { status: 'logged_out' } as unknown as T;
  }

  if (pathname === '/auth/refresh' && method === 'POST') {
    return { refreshed: true } as unknown as T;
  }

  // 3. Settings (/settings/*)
  if (pathname === '/settings/cancel-window' && method === 'PUT') {
    const sec = Number(body.cancel_window_seconds ?? 5);
    user.cancel_window_seconds = sec;
    state.users[user.phone_e164] = user;
    saveState(state);
    return { cancel_window_seconds: sec } as unknown as T;
  }

  if (pathname === '/settings/cancel-pin' && method === 'PUT') {
    user.has_cancel_pin = Boolean(body.pin);
    state.users[user.phone_e164] = user;
    saveState(state);
    return { cancel_pin_configured: user.has_cancel_pin } as unknown as T;
  }

  if (pathname === '/settings/duress-pin' && method === 'PUT') {
    user.has_duress_pin = Boolean(body.pin);
    state.users[user.phone_e164] = user;
    saveState(state);
    return {
      duress_pin_configured: user.has_duress_pin,
      cancel_pin_configured: user.has_cancel_pin,
    } as unknown as T;
  }

  // 4. Consents (/consents)
  if (pathname === '/consents' && method === 'GET') {
    const current = state.consents[user.id] || {
      data_processing: true,
      location: true,
      notifications: true,
      microphone: false,
      camera: false,
    };
    const history = state.consentHistory[user.id] || [];
    return { current, history } as unknown as T;
  }

  if (pathname === '/consents' && method === 'POST') {
    const type = body.type as ConsentType;
    const granted = Boolean(body.granted);
    const current = state.consents[user.id] || {
      data_processing: true,
      location: true,
      notifications: true,
      microphone: false,
      camera: false,
    };
    current[type] = granted;
    state.consents[user.id] = current;
    const entry: ConsentLedgerEntry = {
      id: `c_${Date.now()}`,
      user_id: user.id,
      type,
      granted,
      source: body.source || 'consent_center',
      created_at: now,
    };
    const history = [entry, ...(state.consentHistory[user.id] || [])];
    state.consentHistory[user.id] = history;
    saveState(state);
    return { entry, current, history } as unknown as T;
  }

  // 5. Contacts & Invitations (/contacts*, /invitations/*, /dev/outbox)
  if (pathname === '/contacts' && method === 'GET') {
    return {
      contacts: state.contacts,
      notifiable_contacts_count: getNotifiableCount(state),
    } as unknown as T;
  }

  if (pathname === '/contacts' && method === 'POST') {
    const token = `inv_${Date.now()}`;
    const newContact: TrustedContact = {
      id: `ct_${Date.now()}`,
      user_id: user.id,
      name: body.name || 'Trusted Contact',
      phone_e164: body.phone_e164 || '+919876543219',
      priority_order: state.contacts.length + 1,
      status: 'accepted', // Auto-accept in prototype APK so it works immediately for demo!
      permissions: body.permissions || {
        receives_sos: true,
        receives_checkin: true,
        can_see_live_location: true,
      },
      created_at: now,
      updated_at: now,
    };
    state.contacts.push(newContact);
    const inviteUrl = `/invite/${token}`;
    state.outbox.unshift({
      id: `msg_${Date.now()}`,
      to_phone_e164: newContact.phone_e164,
      body: `${user.name} invited you to their SHAKTI Trusted Circle: ${inviteUrl}`,
      provider: 'MockSmsProvider',
      purpose: 'contact_invitation',
      metadata: {
        contact_id: newContact.id,
        inviter_name: user.name,
        contact_name: newContact.name,
        invitation_url: inviteUrl,
        token,
      },
      created_at: now,
    });
    saveState(state);
    return {
      contact: newContact,
      invitation_token: token,
      invitation_url: inviteUrl,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      notifiable_contacts_count: getNotifiableCount(state),
    } as unknown as T;
  }

  if (pathname === '/contacts/reorder' && method === 'POST') {
    const orderedIds: string[] = body.ordered_ids || [];
    const map = new Map(state.contacts.map((c) => [c.id, c]));
    const reordered: TrustedContact[] = [];
    orderedIds.forEach((id, idx) => {
      const item = map.get(id);
      if (item) {
        reordered.push({ ...item, priority_order: idx + 1 });
        map.delete(id);
      }
    });
    map.forEach((item) => {
      reordered.push({ ...item, priority_order: reordered.length + 1 });
    });
    state.contacts = reordered;
    saveState(state);
    return { contacts: state.contacts } as unknown as T;
  }

  const contactActionMatch = pathname.match(
    /^\/contacts\/([^/]+)(?:\/(pause|resume))?$/
  );
  if (contactActionMatch) {
    const contactId = decodeURIComponent(contactActionMatch[1]);
    const subAction = contactActionMatch[2];
    const idx = state.contacts.findIndex((c) => c.id === contactId);
    if (idx !== -1) {
      if (method === 'DELETE') {
        state.contacts.splice(idx, 1);
        saveState(state);
        return { status: 'removed', id: contactId } as unknown as T;
      }
      if (subAction === 'pause') {
        state.contacts[idx].status = 'paused';
        saveState(state);
        return { contact: state.contacts[idx] } as unknown as T;
      }
      if (subAction === 'resume') {
        state.contacts[idx].status = 'accepted';
        saveState(state);
        return { contact: state.contacts[idx] } as unknown as T;
      }
      if (method === 'PATCH') {
        state.contacts[idx] = {
          ...state.contacts[idx],
          ...(body.name ? { name: body.name } : {}),
          ...(body.phone_e164 ? { phone_e164: body.phone_e164 } : {}),
          ...(body.permissions ? { permissions: body.permissions } : {}),
          updated_at: now,
        };
        saveState(state);
        return { contact: state.contacts[idx] } as unknown as T;
      }
    }
  }

  if (pathname === '/dev/outbox' && method === 'GET') {
    return {
      provider: 'MockSmsProvider',
      messages: state.outbox,
    } as unknown as T;
  }

  const invMatch = pathname.match(
    /^\/invitations\/([^/]+)(?:\/(accept|decline))?$/
  );
  if (invMatch) {
    const contact = state.contacts[0] || createInitialState().contacts[0];
    if (!invMatch[2] && method === 'GET') {
      return {
        inviter_name: user.name,
        contact_name: contact.name,
        permissions: contact.permissions,
        status: 'pending',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      } as unknown as T;
    }
    if (invMatch[2] === 'accept') {
      contact.status = 'accepted';
      saveState(state);
      return { status: 'accepted', contact } as unknown as T;
    }
    if (invMatch[2] === 'decline') {
      return { status: 'declined' } as unknown as T;
    }
  }

  // 6. Incidents (/incidents*)
  if (pathname === '/incidents/active' && method === 'GET') {
    return {
      incident: getActiveIncidentFromState(state),
      notifiable_contacts_count: getNotifiableCount(state),
    } as unknown as T;
  }

  if (pathname === '/incidents' && method === 'POST') {
    const existing = getActiveIncidentFromState(state);
    if (existing) {
      return {
        incident: existing,
        idempotent_replay: false,
        merged_into_existing: true,
        notifiable_contacts_count: getNotifiableCount(state),
      } as unknown as T;
    }
    const incId = `inc_${Date.now()}`;
    const locSample = body.location
      ? {
          id: `loc_${Date.now()}`,
          incident_id: incId,
          lat: body.location.lat,
          lng: body.location.lng,
          accuracy_m: body.location.accuracy_m ?? 12,
          captured_at: body.location.captured_at || now,
          expires_at: Date.now() + 3600000,
        }
      : {
          id: `loc_${Date.now()}`,
          incident_id: incId,
          lat: 28.6139,
          lng: 77.209,
          accuracy_m: 12,
          captured_at: now,
          expires_at: Date.now() + 3600000,
        };

    const newInc: IncidentDto = {
      id: incId,
      user_id: user.id,
      status: user.cancel_window_seconds === 0 ? 'NOTIFIED' : 'TRIGGERED',
      emergency_type: body.emergency_type || null,
      client_request_id: body.client_request_id || `req_${Date.now()}`,
      created_at: now,
      activated_at: user.cancel_window_seconds === 0 ? now : null,
      closed_at: null,
      merged_into_id: null,
      source_trigger: body.source_trigger || 'button',
      is_duress: false,
      needs_user_action: false,
      escalation_stage: 0,
      auto_expire_minutes: 60,
      notifiable_contacts_count: getNotifiableCount(state),
      events: [
        {
          id: `ev_${Date.now()}`,
          incident_id: incId,
          from_status: null,
          to_status: user.cancel_window_seconds === 0 ? 'NOTIFIED' : 'TRIGGERED',
          actor_type: 'user',
          actor_id: user.id,
          note: `SOS triggered via ${body.source_trigger || 'button'}`,
          created_at: now,
        },
      ],
      locations: [locSample],
      notifications: state.contacts
        .filter((c) => c.status === 'accepted' && c.permissions.receives_sos)
        .map((c, i) => ({
          id: `notif_${Date.now()}_${i}`,
          incident_id: incId,
          recipient_type: 'contact',
          recipient_ref: c.name,
          channel: 'sms',
          status: 'sent',
          attempts: 1,
          last_error: null,
          created_at: now,
        })),
    };
    state.incidents.unshift(newInc);
    saveState(state);
    return {
      incident: newInc,
      idempotent_replay: false,
      merged_into_existing: false,
      notifiable_contacts_count: getNotifiableCount(state),
    } as unknown as T;
  }

  const incMatch = pathname.match(
    /^\/incidents\/([^/]+)(?:\/(cancel|location|type|resolve|rating))?$/
  );
  if (incMatch) {
    const incId = decodeURIComponent(incMatch[1]);
    const subAction = incMatch[2];
    const inc =
      state.incidents.find((i) => i.id === incId) ||
      getActiveIncidentFromState(state) ||
      state.incidents[0];

    if (!inc) {
      throw new Error('Incident not found');
    }

    // Auto-transition TRIGGERED -> NOTIFIED once cancel window passes
    if (
      inc.status === 'TRIGGERED' &&
      !subAction &&
      Date.now() - new Date(inc.created_at).getTime() >=
        (user.cancel_window_seconds ?? 5) * 1000
    ) {
      inc.status = 'NOTIFIED';
      inc.activated_at = now;
      inc.events = [
        ...(inc.events || []),
        {
          id: `ev_${Date.now()}`,
          incident_id: inc.id,
          from_status: 'TRIGGERED',
          to_status: 'NOTIFIED',
          actor_type: 'system',
          actor_id: null,
          note: 'Cancel window elapsed — Trusted Circle and Campus Responders notified',
          created_at: now,
        },
      ];
      saveState(state);
    }

    if (!subAction && method === 'GET') {
      return {
        incident: inc,
        notifiable_contacts_count: getNotifiableCount(state),
      } as unknown as T;
    }

    if (subAction === 'cancel' && method === 'POST') {
      inc.status = 'CANCELLED';
      inc.closed_at = now;
      inc.events = [
        ...(inc.events || []),
        {
          id: `ev_${Date.now()}`,
          incident_id: inc.id,
          from_status: 'TRIGGERED',
          to_status: 'CANCELLED',
          actor_type: 'user',
          actor_id: user.id,
          note: 'Cancelled by user within window',
          created_at: now,
        },
      ];
      saveState(state);
      return {
        status: 'cancelled',
        incident: inc,
        notifiable_contacts_count: getNotifiableCount(state),
      } as unknown as T;
    }

    if (subAction === 'location' && method === 'POST') {
      const sample = {
        id: `loc_${Date.now()}`,
        incident_id: inc.id,
        lat: body.lat ?? 28.6139,
        lng: body.lng ?? 77.209,
        accuracy_m: body.accuracy_m ?? 10,
        captured_at: body.captured_at || now,
        expires_at: Date.now() + 3600000,
      };
      inc.locations = [...(inc.locations || []), sample];
      saveState(state);
      return { location: sample } as unknown as T;
    }

    if (subAction === 'type' && method === 'POST') {
      inc.emergency_type = body.emergency_type || null;
      saveState(state);
      return { incident: inc } as unknown as T;
    }

    if (subAction === 'resolve' && method === 'POST') {
      inc.status = body.resolution === 'FALSE_ALARM' ? 'FALSE_ALARM' : 'RESOLVED';
      inc.closed_at = now;
      inc.events = [
        ...(inc.events || []),
        {
          id: `ev_${Date.now()}`,
          incident_id: inc.id,
          from_status: 'NOTIFIED',
          to_status: inc.status,
          actor_type: 'user',
          actor_id: user.id,
          note: body.note || 'User marked themselves safe',
          created_at: now,
        },
      ];
      saveState(state);
      return { incident: inc } as unknown as T;
    }

    if (subAction === 'rating' && method === 'POST') {
      return {
        rating: {
          incident_id: inc.id,
          score: Number(body.score || 5),
          created_at: now,
        },
      } as unknown as T;
    }
  }

  // 7. Demo Simulation (/demo/simulate/responder, /demo/simulate/contact)
  if (pathname === '/demo/simulate/responder' && method === 'POST') {
    const inc = getActiveIncidentFromState(state) || state.incidents[0];
    if (inc) {
      const action = body.action as 'acknowledge' | 'responding' | 'resolve';
      const nextStatus: IncidentStatus =
        action === 'acknowledge'
          ? 'ACKNOWLEDGED'
          : action === 'responding'
            ? 'RESPONDING'
            : 'RESOLVED';
      const prevStatus = inc.status;
      inc.status = nextStatus;
      if (!inc.activated_at) inc.activated_at = now;
      if (nextStatus === 'RESOLVED') inc.closed_at = now;
      inc.events = [
        ...(inc.events || []),
        {
          id: `ev_${Date.now()}`,
          incident_id: inc.id,
          from_status: prevStatus,
          to_status: nextStatus,
          actor_type: 'responder',
          actor_id: 'usr_demo_2',
          note: body.note || `Simulated responder action: ${action}`,
          created_at: now,
        },
      ];
      saveState(state);
      return {
        simulated: true,
        actor_type: 'responder',
        action,
        incident_id: inc.id,
        incident_status: inc.status,
        incident: toResponderDetail(inc, state),
      } as unknown as T;
    }
  }

  if (pathname === '/demo/simulate/contact' && method === 'POST') {
    const inc = getActiveIncidentFromState(state) || state.incidents[0];
    if (inc) {
      const action = body.action as 'seen' | 'on_my_way';
      const nextStatus: IncidentStatus =
        action === 'on_my_way' ? 'RESPONDING' : 'ACKNOWLEDGED';
      const prevStatus = inc.status;
      inc.status = nextStatus;
      if (!inc.activated_at) inc.activated_at = now;
      const contact = state.contacts[0] || createInitialState().contacts[0];
      inc.events = [
        ...(inc.events || []),
        {
          id: `ev_${Date.now()}`,
          incident_id: inc.id,
          from_status: prevStatus,
          to_status: nextStatus,
          actor_type: 'contact',
          actor_id: contact.id,
          note: `${contact.name} responded: ${action}`,
          created_at: now,
        },
      ];
      saveState(state);
      return {
        simulated: true,
        actor_type: 'contact',
        contact_id: contact.id,
        contact_name: contact.name,
        action,
        incident_id: inc.id,
        incident_status: inc.status,
        summary: toContactSummary(inc, contact),
      } as unknown as T;
    }
  }

  // 8. Contact Magic Link (/c/:token)
  const magicMatch = pathname.match(/^\/c\/([^/]+)(?:\/(respond))?$/);
  if (magicMatch) {
    const inc = getActiveIncidentFromState(state) || state.incidents[0];
    const contact = state.contacts[0] || createInitialState().contacts[0];
    if (!inc) {
      throw new Error('Alert closed or expired');
    }
    if (!magicMatch[2] && method === 'GET') {
      return toContactSummary(inc, contact) as unknown as T;
    }
    if (magicMatch[2] === 'respond' && method === 'POST') {
      const act = body.action as ContactResponseAction;
      if (act === 'confirm_safe') {
        inc.status = 'RESOLVED';
        inc.closed_at = now;
      } else if (act === 'on_my_way') {
        inc.status = 'RESPONDING';
      } else if (act === 'seen' || act === 'calling_her') {
        inc.status = 'ACKNOWLEDGED';
      }
      saveState(state);
      return {
        action: act,
        incident_status: inc.status,
        closed: inc.status === 'RESOLVED',
        summary: toContactSummary(inc, contact),
      } as unknown as T;
    }
  }

  // 9. Responder Console (/responder/incidents*)
  if (pathname === '/responder/incidents' && method === 'GET') {
    const responder = state.responders[0];
    const colleagues = state.responders.slice(1);
    const list = state.incidents.map((inc) => toResponderDetail(inc, state));
    return {
      responder,
      colleagues,
      incidents: list,
    } as unknown as T;
  }

  const respIncMatch = pathname.match(
    /^\/responder\/incidents\/([^/]+)(?:\/(acknowledge|assign|note|responding|resolve|false-alarm))?$/
  );
  if (respIncMatch) {
    const incId = decodeURIComponent(respIncMatch[1]);
    const act = respIncMatch[2];
    const inc =
      state.incidents.find((i) => i.id === incId) || state.incidents[0];
    if (!inc) throw new Error('Incident not found');
    if (act && method === 'POST') {
      const prev = inc.status;
      if (act === 'acknowledge') inc.status = 'ACKNOWLEDGED';
      if (act === 'responding') inc.status = 'RESPONDING';
      if (act === 'resolve') {
        inc.status = 'RESOLVED';
        inc.closed_at = now;
      }
      if (act === 'false-alarm') {
        inc.status = 'FALSE_ALARM';
        inc.closed_at = now;
      }
      inc.events = [
        ...(inc.events || []),
        {
          id: `ev_${Date.now()}`,
          incident_id: inc.id,
          from_status: prev,
          to_status: inc.status,
          actor_type: 'responder',
          actor_id: state.responders[0].user_id,
          note: body.note || `Responder action: ${act}`,
          created_at: now,
        },
      ];
      saveState(state);
    }
    return { incident: toResponderDetail(inc, state) } as unknown as T;
  }

  // 10. Safe Journeys (/journeys*)
  if (pathname === '/journeys/active' && method === 'GET') {
    const active =
      state.journeys.find(
        (j) => j.status === 'active' || j.status === 'lapsed'
      ) || null;
    return { journey: active } as unknown as T;
  }

  if (pathname === '/journeys' && method === 'POST') {
    const durMin = Number(body.duration_minutes || 15);
    const contact = state.contacts.find((c) => c.id === body.contact_id) || null;
    const newJourney: JourneyDto = {
      id: `jrn_${Date.now()}`,
      user_id: user.id,
      contact_id: contact ? contact.id : null,
      contact_name: contact ? contact.name : null,
      started_at: now,
      ends_at: new Date(Date.now() + durMin * 60000).toISOString(),
      status: 'active',
      reminder_sent_at: null,
      lapsed_notified_at: null,
      note: body.note || null,
    };
    state.journeys = [newJourney];
    saveState(state);
    return { journey: newJourney } as unknown as T;
  }

  const jrnMatch = pathname.match(
    /^\/journeys\/([^/]+)\/(extend|complete|cancel)$/
  );
  if (jrnMatch && method === 'POST') {
    const jrn = state.journeys[0];
    if (jrn) {
      const act = jrnMatch[2];
      if (act === 'extend') {
        const addMin = Number(body.additional_minutes || 10);
        jrn.ends_at = new Date(
          new Date(jrn.ends_at).getTime() + addMin * 60000
        ).toISOString();
      } else if (act === 'complete') {
        jrn.status = 'completed';
      } else if (act === 'cancel') {
        jrn.status = 'cancelled';
      }
      saveState(state);
      return { journey: jrn } as unknown as T;
    }
  }

  // 11. Safety Reports & Layer (/reports, /safety-layer)
  if (pathname === '/safety-layer' && method === 'GET') {
    return {
      k_threshold: 5,
      cell_precision_decimals: 3,
      approx_cell_size_meters: 110,
      cells: state.reportsCells,
    } as unknown as T;
  }

  if (pathname === '/reports' && method === 'POST') {
    const lat = Number(Number(body.lat ?? 28.614).toFixed(3));
    const lng = Number(Number(body.lng ?? 77.209).toFixed(3));
    const cellId = `${lat.toFixed(3)}_${lng.toFixed(3)}`;
    const cat = (body.category || 'poor_lighting') as ReportCategory;
    const existingCell = state.reportsCells.find((c) => c.cell_id === cellId);
    if (existingCell) {
      existingCell.total_count += 1;
      existingCell.categories[cat] = (existingCell.categories[cat] || 0) + 1;
      existingCell.last_reported_at = now;
    } else {
      state.reportsCells.unshift({
        cell_id: cellId,
        lat,
        lng,
        total_count: 5, // Immediately meet k=5 threshold in prototype demo so judges see the new cell on the map!
        categories: { [cat]: 5 },
        last_reported_at: now,
      });
    }
    saveState(state);
    return {
      report: {
        id: `rep_${Date.now()}`,
        category: cat,
        lat,
        lng,
        anonymous: Boolean(body.anonymous),
        created_at: now,
      },
    } as unknown as T;
  }

  // 12. Resources & Weekly Pulse (/resources, /admin/resources*, /pulse*)
  if (pathname === '/resources' && method === 'GET') {
    const q = (searchParams.get('q') || '').trim().toLowerCase();
    const cat = searchParams.get('category') || 'all';
    const filtered = state.resources.filter((r) => {
      if (cat !== 'all' && r.category !== cat) return false;
      if (
        q &&
        !`${r.name} ${r.phone} ${r.description}`.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
    return { resources: filtered } as unknown as T;
  }

  if (pathname === '/admin/resources' && method === 'POST') {
    const newRes: ResourceDto = {
      id: `res_${Date.now()}`,
      name: body.name || 'New Support Service',
      category: body.category || 'women_helpline',
      phone: body.phone || '181',
      description: body.description || '',
      available_hours: body.available_hours || '24x7',
      active: body.active !== false,
    };
    state.resources.unshift(newRes);
    saveState(state);
    return { resource: newRes } as unknown as T;
  }

  const adminResMatch = pathname.match(/^\/admin\/resources\/([^/]+)$/);
  if (adminResMatch) {
    const rId = decodeURIComponent(adminResMatch[1]);
    if (method === 'DELETE') {
      state.resources = state.resources.filter((r) => r.id !== rId);
      saveState(state);
      return { deleted_id: rId } as unknown as T;
    }
    if (method === 'PUT') {
      const idx = state.resources.findIndex((r) => r.id === rId);
      if (idx !== -1) {
        state.resources[idx] = { ...state.resources[idx], ...body };
        saveState(state);
        return { resource: state.resources[idx] } as unknown as T;
      }
    }
  }

  if (pathname === '/pulse/status' && method === 'GET') {
    return {
      should_prompt: !state.lastPulseAt,
      last_submitted_at: state.lastPulseAt,
      next_eligible_at: state.lastPulseAt
        ? new Date(Date.now() + 7 * 86400000).toISOString()
        : null,
    } as unknown as T;
  }

  if (pathname === '/pulse' && method === 'POST') {
    state.lastPulseAt = now;
    saveState(state);
    return {
      pulse: {
        id: `pls_${Date.now()}`,
        safety_score: Number(body.safety_score || 4),
        avoided_going_somewhere: Boolean(body.avoided_going_somewhere),
        anonymous: Boolean(body.anonymous),
        created_at: now,
      },
    } as unknown as T;
  }

  // 13. Safety Tools (/safety-tools, /admin/safety-tools*)
  if (pathname === '/safety-tools' && method === 'GET') {
    const cat = searchParams.get('category') || 'all';
    const includeInactive = searchParams.get('include_inactive') === 'true';
    const items = state.safetyTools.filter((t) => {
      if (!includeInactive && !t.active) return false;
      if (cat !== 'all' && t.category !== cat) return false;
      return true;
    });
    return { safety_tools: items } as unknown as T;
  }

  if (pathname === '/admin/safety-tools' && method === 'POST') {
    const newTool: SafetyToolDto = {
      id: `tool_${Date.now()}`,
      category: body.category || 'personal_alarm_keychain',
      title: body.title || 'Safety Tool',
      description: body.description || '',
      safe_use_notes: body.safe_use_notes || '',
      legal_note: body.legal_note || '',
      link_url: body.link_url || null,
      link_label: body.link_label || 'View item link',
      last_checked: body.last_checked || now.slice(0, 10),
      active: body.active !== false,
      is_affiliate: Boolean(body.is_affiliate),
    };
    state.safetyTools.unshift(newTool);
    saveState(state);
    return { safety_tool: newTool } as unknown as T;
  }

  const adminToolMatch = pathname.match(/^\/admin\/safety-tools\/([^/]+)$/);
  if (adminToolMatch) {
    const tId = decodeURIComponent(adminToolMatch[1]);
    if (method === 'DELETE') {
      state.safetyTools = state.safetyTools.filter((t) => t.id !== tId);
      saveState(state);
      return { success: true, deleted_id: tId } as unknown as T;
    }
    if (method === 'PUT') {
      const idx = state.safetyTools.findIndex((t) => t.id === tId);
      if (idx !== -1) {
        state.safetyTools[idx] = { ...state.safetyTools[idx], ...body };
        saveState(state);
        return { safety_tool: state.safetyTools[idx] } as unknown as T;
      }
    }
  }

  // 14. Admin Metrics, Audit Logs, Responders (/admin/*)
  if (pathname === '/admin/metrics' && method === 'GET') {
    const metrics: ImpactMetricsResponseDto = {
      range: {
        from: searchParams.get('from') || '2026-10-01',
        to: searchParams.get('to') || '2026-10-28',
      },
      minimum_sample_size: 5,
      includes_demo_data: true,
      metrics: {
        alert_initiation_time: {
          metric: 'alert_initiation_time',
          value: 2.1,
          median_seconds: 2.1,
          p90_seconds: 2.8,
          n: 12,
          target: '<= 3.0s',
          formula: 'Median seconds from hold start to incident creation',
          insufficient_data: false,
          unit: 's',
        },
        time_to_active: {
          metric: 'time_to_active',
          value: 5.2,
          median_seconds: 5.2,
          p90_seconds: 6.0,
          n: 10,
          target: 'Informational',
          formula: 'Seconds from trigger to active dispatch after cancel window',
          insufficient_data: false,
          informational: true,
          unit: 's',
        },
        notification_delivery_rate: {
          metric: 'notification_delivery_rate',
          value: 98.4,
          n: 24,
          target: '>= 95%',
          formula: 'Delivered notifications / total dispatched notifications',
          insufficient_data: false,
          unit: '%',
          by_channel: {
            sms: {
              n: 16,
              succeeded: 16,
              value: 100,
              rate_percent: 100,
              insufficient_data: false,
            },
            push: {
              n: 8,
              succeeded: 7,
              value: 87.5,
              rate_percent: 87.5,
              insufficient_data: false,
            },
          },
        },
        time_to_first_acknowledgement: {
          metric: 'time_to_first_acknowledgement',
          value: 18.5,
          median_seconds: 18.5,
          p90_seconds: 34.0,
          n: 10,
          target: '<= 45s',
          formula: 'Median seconds from active alert to first contact/responder ack',
          insufficient_data: false,
          unit: 's',
        },
        time_to_resolution: {
          metric: 'time_to_resolution',
          value: 142,
          median_seconds: 142,
          p90_seconds: 240,
          n: 9,
          target: 'Tracked',
          formula: 'Median seconds from trigger to resolved safe state',
          insufficient_data: false,
          unit: 's',
        },
        cancellation_rate: {
          metric: 'cancellation_rate',
          value: 16.7,
          cancelled_count: 2,
          n: 12,
          target: 'Tracked',
          formula: 'Alerts cancelled inside window / total triggered alerts',
          insufficient_data: false,
          unit: '%',
        },
        false_alarm_rate: {
          metric: 'false_alarm_rate',
          value: 8.3,
          false_alarm_count: 1,
          n: 12,
          target: '<= 10%',
          formula: 'False alarms / total activated alerts',
          insufficient_data: false,
          unit: '%',
        },
        location_availability: {
          metric: 'location_availability',
          value: 91.7,
          active_with_location_count: 11,
          median_accuracy_meters: 11.5,
          n: 12,
          target: '>= 85%',
          formula: 'Active alerts with consented GPS sample / total active alerts',
          insufficient_data: false,
          unit: '%',
        },
        audit_completeness: {
          metric: 'audit_completeness',
          value: 100,
          valid_chain_count: 12,
          n: 12,
          target: '100%',
          formula: 'Incidents with complete state transition & access audit log',
          insufficient_data: false,
          unit: '%',
        },
        safety_pulse: {
          metric: 'safety_pulse',
          value: 4.3,
          average_score: 4.3,
          avoided_going_somewhere_percent: 14.2,
          n: 18,
          target: '>= 4.0 / 5',
          formula: 'Weekly community safety pulse average score',
          insufficient_data: false,
          by_week: [
            {
              week: '2026-W41',
              week_start: '2026-10-05',
              n: 6,
              value: 4.1,
              average_score: 4.1,
              avoided_going_somewhere_percent: 16.7,
              insufficient_data: false,
            },
            {
              week: '2026-W42',
              week_start: '2026-10-12',
              n: 6,
              value: 4.3,
              average_score: 4.3,
              avoided_going_somewhere_percent: 16.7,
              insufficient_data: false,
            },
            {
              week: '2026-W43',
              week_start: '2026-10-19',
              n: 6,
              value: 4.5,
              average_score: 4.5,
              avoided_going_somewhere_percent: 10.0,
              insufficient_data: false,
            },
          ],
        },
        post_incident_trust_score: {
          metric: 'post_incident_trust_score',
          value: 4.7,
          average_score: 4.7,
          n: 8,
          target: '>= 4.2 / 5',
          formula: 'Mean post-incident helpfulness rating (1-5)',
          insufficient_data: false,
        },
      },
    };
    return metrics as unknown as T;
  }

  if (pathname === '/admin/audit-logs' && method === 'GET') {
    return { entries: state.auditLogs } as unknown as T;
  }

  if (pathname === '/admin/responders' && method === 'GET') {
    const list: AdminResponderDto[] = state.responders.map((r) => ({
      id: r.id,
      name: r.name,
      organization_zone: r.organization_zone,
      active: r.active,
      on_duty: r.on_duty,
    }));
    return { responders: list } as unknown as T;
  }

  const adminRespMatch = pathname.match(/^\/admin\/responders\/([^/]+)$/);
  if (adminRespMatch && method === 'PATCH') {
    const rId = decodeURIComponent(adminRespMatch[1]);
    const idx = state.responders.findIndex((r) => r.id === rId);
    if (idx !== -1) {
      state.responders[idx] = {
        ...state.responders[idx],
        ...(body.active !== undefined ? { active: Boolean(body.active) } : {}),
        ...(body.on_duty !== undefined
          ? { on_duty: Boolean(body.on_duty) }
          : {}),
      };
      saveState(state);
      return {
        responder: state.responders[idx],
        warning: null,
      } as unknown as T;
    }
  }

  return {} as unknown as T;
}

function toResponderDetail(
  inc: IncidentDto,
  state: StandaloneState
): ResponderIncidentDetailDto {
  const lastLoc =
    inc.locations && inc.locations.length > 0
      ? inc.locations[inc.locations.length - 1]
      : null;
  const acked =
    inc.status === 'ACKNOWLEDGED' ||
    inc.status === 'RESPONDING' ||
    inc.status === 'RESOLVED';
  return {
    id: inc.id,
    user_first_name: 'Aarohi',
    user_phone_e164: acked ? '+919000000001' : null,
    organization_zone: 'North Campus Zone',
    status: inc.status,
    emergency_type: inc.emergency_type,
    source_trigger: inc.source_trigger,
    is_duress: inc.is_duress,
    duress_notice: inc.is_duress
      ? 'Silent alert: do not contact her directly.'
      : null,
    created_at: inc.created_at,
    activated_at: inc.activated_at || inc.created_at,
    closed_at: inc.closed_at,
    acknowledged_by_responder: acked,
    assigned_responder_user_ids: [state.responders[0].user_id],
    latest_location: lastLoc
      ? {
          lat: lastLoc.lat,
          lng: lastLoc.lng,
          accuracy_m: lastLoc.accuracy_m,
          captured_at: lastLoc.captured_at,
        }
      : null,
    mock_112_gateway: {
      is_mock: true,
      label: 'MOCK',
      provider: 'MockEmergencyGateway',
      status: 'STANDBY_READY',
      reference_id: `112-DEMO-${inc.id.slice(-4)}`,
    },
    events: inc.events || [],
    assignments: [
      {
        id: `asgn_${inc.id}`,
        responder_id: state.responders[0].id,
        responder_user_id: state.responders[0].user_id,
        organization_zone: 'North Campus Zone',
        assigned_by_user_id: null,
        acknowledged_at: acked ? new Date().toISOString() : null,
        created_at: inc.created_at,
      },
    ],
  };
}

function toContactSummary(
  inc: IncidentDto,
  contact: TrustedContact
): ContactIncidentSummaryDto {
  const lastLoc =
    inc.locations && inc.locations.length > 0
      ? inc.locations[inc.locations.length - 1]
      : undefined;
  return {
    incident_id: inc.id,
    user_first_name: 'Aarohi',
    user_phone_e164: '+919000000001',
    contact_id: contact.id,
    contact_name: contact.name,
    triggered_at: inc.created_at,
    activated_at: inc.activated_at || inc.created_at,
    emergency_type: inc.emergency_type,
    status: inc.status,
    is_duress: inc.is_duress,
    duress_notice: null,
    can_see_live_location: true,
    location_freshness_seconds: 2,
    location: lastLoc
      ? {
          lat: lastLoc.lat,
          lng: lastLoc.lng,
          accuracy_m: lastLoc.accuracy_m,
          captured_at: lastLoc.captured_at,
        }
      : undefined,
  };
}
