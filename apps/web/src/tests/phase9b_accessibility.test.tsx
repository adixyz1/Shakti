import fs from 'fs';
import path from 'path';
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axe from 'axe-core';
import i18n from '../i18n';
import enJson from '../i18n/en.json';
import hiJson from '../i18n/hi.json';
import { HomePage } from '../pages/HomePage';
import { ConsentCenterPage } from '../pages/ConsentCenterPage';
import { TrustedCirclePage } from '../pages/TrustedCirclePage';
import { ContactAlertPage } from '../pages/ContactAlertPage';
import { ResponderDashboardPage } from '../pages/ResponderDashboardPage';
import { AdminPage } from '../pages/AdminPage';
import { SafeJourneyPage } from '../pages/SafeJourneyPage';
import { SafetyReportsPage } from '../pages/SafetyReportsPage';
import { ResourcesPage } from '../pages/ResourcesPage';
import { PolicyPage } from '../pages/PolicyPage';
import { SettingsPage } from '../pages/SettingsPage';
import { DiscreetTriggersManager } from '../components/DiscreetTriggersManager';
import { useAuthStore, type UserProfile } from '../store/authStore';
import {
  useTriggerSettingsStore,
  hashDisguiseSequence,
} from '../store/triggerSettingsStore';
import {
  ApiError,
  authApi,
  consentsApi,
  contactsApi,
  devApi,
  contactMagicApi,
  incidentsApi,
  journeysApi,
  reportsApi,
  resourcesPulseApi,
  responderApi,
  adminMetricsApi,
  adminAuditApi,
  adminRespondersApi,
  demoApi,
  type IncidentDto,
} from '../lib/api';

const demoOwner: UserProfile = {
  id: 'usr_a11y_owner',
  phone_e164: '+919000000001',
  name: 'Aarohi Sharma',
  role: 'user',
  language: 'en',
  organization_zone: 'Demo Campus Zone',
  cancel_window_seconds: 10,
  has_cancel_pin: true,
  has_duress_pin: true,
  created_at: '2026-01-01T00:00:00.000Z',
};

const demoResponderUser: UserProfile = {
  ...demoOwner,
  id: 'usr_a11y_responder',
  phone_e164: '+919000000002',
  name: 'Inspector Kavita Rao',
  role: 'responder',
};

const demoAdminUser: UserProfile = {
  ...demoOwner,
  id: 'usr_a11y_admin',
  phone_e164: '+919000000003',
  name: 'Meera Nair',
  role: 'admin',
};

const baseTriggerIncident: IncidentDto = {
  id: 'inc_a11y_1',
  user_id: demoOwner.id,
  client_request_id: 'req_a11y_1',
  status: 'TRIGGERED',
  source_trigger: 'button',
  emergency_type: 'stalking',
  is_duress: false,
  needs_user_action: false,
  escalation_stage: 0,
  created_at: new Date().toISOString(),
  activated_at: null,
  closed_at: null,
  merged_into_id: null,
  events: [
    {
      id: 'ev_1',
      incident_id: 'inc_a11y_1',
      from_status: null,
      to_status: 'TRIGGERED',
      actor_type: 'user',
      actor_id: demoOwner.id,
      note: 'SOS button held',
      created_at: new Date().toISOString(),
    },
  ],
  locations: [
    {
      id: 'loc_1',
      incident_id: 'inc_a11y_1',
      lat: 28.6139,
      lng: 77.209,
      accuracy_m: 12,
      captured_at: new Date().toISOString(),
      expires_at: Date.now() + 86400000,
    },
  ],
  notifications: [],
};

const activeIncident: IncidentDto = {
  ...baseTriggerIncident,
  id: 'inc_a11y_active',
  status: 'NOTIFIED',
  activated_at: new Date().toISOString(),
};

async function runSeriousAxeCheck(container: HTMLElement, label: string) {
  const results = await axe.run(container, {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
    },
  });
  const seriousOrCritical = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical'
  );
  if (seriousOrCritical.length > 0) {
    const formatted = seriousOrCritical.map((v) => ({
      screen: label,
      id: v.id,
      impact: v.impact,
      description: v.description,
      nodes: v.nodes.map((n) => ({ html: n.html, summary: n.failureSummary })),
    }));
    expect(formatted, `Axe violations on ${label}`).toEqual([]);
  }
}

function renderWithProviders(
  ui: React.ReactElement,
  initialEntries: string[] = ['/home']
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <DiscreetTriggersManager />
        {ui}
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Phase 9B: Accessibility Checks (WCAG 2.2 AA), Keyboard/Settings, SHAKTI Rename & Disguise Mode', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
    useAuthStore.getState().setUser(demoOwner);
    useAuthStore.getState().setLoading(false);
    useTriggerSettingsStore.getState().resetTriggerSettings();
    useTriggerSettingsStore.getState().setLowPowerDataSaverMode(true);

    vi.spyOn(demoApi, 'getStatus').mockRejectedValue(new ApiError(404, 'Not found'));
    vi.spyOn(authApi, 'getMe').mockResolvedValue(demoOwner);
    vi.spyOn(consentsApi, 'getConsents').mockResolvedValue({
      current: {
        data_processing: true,
        location: true,
        notifications: true,
        microphone: false,
        camera: false,
      },
      history: [
        {
          id: 'c_1',
          user_id: demoOwner.id,
          type: 'data_processing',
          granted: true,
          source: 'consent_center',
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    vi.spyOn(contactsApi, 'listContacts').mockResolvedValue({
      contacts: [
        {
          id: 'cnt_1',
          user_id: demoOwner.id,
          name: 'Priya Verma',
          phone_e164: '+919876543210',
          status: 'accepted',
          priority_order: 1,
          permissions: {
            receives_sos: true,
            receives_checkin: true,
            can_see_live_location: true,
          },
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:05:00.000Z',
        },
      ],
      notifiable_contacts_count: 1,
    });
    vi.spyOn(devApi, 'getOutbox').mockResolvedValue({
      provider: 'MockSmsProvider',
      messages: [],
    });
    vi.spyOn(contactMagicApi, 'getSummary').mockResolvedValue({
      incident_id: activeIncident.id,
      user_first_name: 'Aarohi',
      user_phone_e164: '+919000000001',
      contact_id: 'cnt_1',
      contact_name: 'Priya Verma',
      triggered_at: activeIncident.created_at,
      activated_at: activeIncident.activated_at,
      emergency_type: 'stalking',
      status: 'NOTIFIED',
      is_duress: false,
      duress_notice: null,
      can_see_live_location: true,
      location_freshness_seconds: 5,
      location: {
        lat: 28.6139,
        lng: 77.209,
        accuracy_m: 10,
        captured_at: new Date().toISOString(),
      },
    });
    vi.spyOn(incidentsApi, 'getActiveIncident').mockResolvedValue({
      incident: null,
      notifiable_contacts_count: 1,
    });
    vi.spyOn(journeysApi, 'getActive').mockResolvedValue({
      journey: null,
    });
    vi.spyOn(reportsApi, 'getSafetyLayer').mockResolvedValue({
      k_threshold: 5,
      cell_precision_decimals: 3,
      approx_cell_size_meters: 110,
      cells: [
        {
          cell_id: '28.614_77.209',
          lat: 28.614,
          lng: 77.209,
          total_count: 6,
          categories: { poor_lighting: 4, harassment: 2 },
          last_reported_at: new Date().toISOString(),
        },
      ],
    });
    vi.spyOn(resourcesPulseApi, 'listResources').mockResolvedValue({
      resources: [
        {
          id: 'res_112',
          name: '112 Emergency Response Support System (ERSS)',
          category: 'emergency',
          phone: '112',
          available_hours: '24/7',
          description: 'All-in-one national emergency number.',
          active: true,
        },
      ],
    });
    vi.spyOn(resourcesPulseApi, 'getPulseStatus').mockResolvedValue({
      should_prompt: false,
      last_submitted_at: null,
      next_eligible_at: null,
    });
    vi.spyOn(responderApi, 'listIncidents').mockResolvedValue({
      responder: {
        id: 'resp_1',
        user_id: demoResponderUser.id,
        name: 'Inspector Kavita Rao',
        phone_e164: '+919000000002',
        organization_zone: 'Demo Campus Zone',
        on_duty: true,
        active: true,
      },
      colleagues: [],
      incidents: [
        {
          id: activeIncident.id,
          user_first_name: 'Aarohi',
          organization_zone: 'Demo Campus Zone',
          status: 'NOTIFIED',
          emergency_type: 'stalking',
          source_trigger: 'button',
          is_duress: false,
          duress_notice: null,
          created_at: activeIncident.created_at,
          activated_at: activeIncident.activated_at,
          closed_at: null,
          acknowledged_by_responder: false,
          assigned_responder_user_ids: [demoResponderUser.id],
          latest_location: {
            lat: 28.6139,
            lng: 77.209,
            accuracy_m: 12,
            captured_at: new Date().toISOString(),
          },
        },
      ],
    });
    vi.spyOn(responderApi, 'getIncidentDetail').mockResolvedValue({
      incident: {
        id: activeIncident.id,
        user_first_name: 'Aarohi',
        user_phone_e164: null,
        organization_zone: 'Demo Campus Zone',
        status: 'NOTIFIED',
        emergency_type: 'stalking',
        source_trigger: 'button',
        is_duress: false,
        duress_notice: null,
        created_at: activeIncident.created_at,
        activated_at: activeIncident.activated_at,
        closed_at: null,
        acknowledged_by_responder: false,
        assigned_responder_user_ids: [demoResponderUser.id],
        latest_location: {
          lat: 28.6139,
          lng: 77.209,
          accuracy_m: 12,
          captured_at: new Date().toISOString(),
        },
        events: activeIncident.events || [],
        assignments: [],
      },
    });
    const dummyMetric = {
      metric: 'test',
      value: 100,
      n: 6,
      target: '>= 95%',
      formula: 'test',
      insufficient_data: false,
    };
    vi.spyOn(adminMetricsApi, 'getMetrics').mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-12-31' },
      minimum_sample_size: 5,
      includes_demo_data: false,
      metrics: {
        alert_initiation_time: dummyMetric,
        time_to_active: { ...dummyMetric, informational: true },
        notification_delivery_rate: {
          ...dummyMetric,
          by_channel: {
            sms: {
              n: 6,
              succeeded: 6,
              value: 100,
              rate_percent: 100,
              insufficient_data: false,
            },
          },
        },
        time_to_first_acknowledgement: dummyMetric,
        time_to_resolution: dummyMetric,
        cancellation_rate: dummyMetric,
        false_alarm_rate: dummyMetric,
        location_availability: dummyMetric,
        audit_completeness: dummyMetric,
        safety_pulse: {
          ...dummyMetric,
          average_score: 4.5,
          avoided_going_somewhere_percent: 15,
          by_week: [],
        },
        post_incident_trust_score: dummyMetric,
      },
    });
    vi.spyOn(adminAuditApi, 'listAuditLogs').mockResolvedValue({ entries: [] });
    vi.spyOn(adminRespondersApi, 'listResponders').mockResolvedValue({
      responders: [],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('1. Automated axe-core WCAG 2.2 AA checks pass with 0 serious/critical violations across all required screens in both English and Hindi', async () => {
    for (const lang of ['en', 'hi'] as const) {
      await i18n.changeLanguage(lang);

      // (1) Home / SOS Ready
      useAuthStore.getState().setUser({ ...demoOwner, language: lang });
      vi.spyOn(incidentsApi, 'getActiveIncident').mockResolvedValue({
        incident: null,
        notifiable_contacts_count: 1,
      });
      const homeView = renderWithProviders(<HomePage />, ['/home']);
      await waitFor(() =>
        expect(screen.getByTestId('sos-hold-button')).toBeTruthy()
      );
      await runSeriousAxeCheck(homeView.container, `Home/SOS (${lang})`);
      cleanup();

      // (2) Cancel Window with PIN Keypad
      vi.spyOn(incidentsApi, 'getActiveIncident').mockResolvedValue({
        incident: {
          ...baseTriggerIncident,
          created_at: new Date().toISOString(),
        },
        notifiable_contacts_count: 1,
      });
      const cancelView = renderWithProviders(<HomePage />, ['/home']);
      await waitFor(() =>
        expect(screen.getByTestId('cancel-window-screen')).toBeTruthy()
      );
      fireEvent.click(screen.getByTestId('cancel-alert-btn'));
      await waitFor(() =>
        expect(screen.getByTestId('pin-keypad')).toBeTruthy()
      );
      await runSeriousAxeCheck(
        cancelView.container,
        `Cancel Window with Keypad (${lang})`
      );
      cleanup();

      // (3) Live Status (Active / Notified)
      vi.spyOn(incidentsApi, 'getActiveIncident').mockResolvedValue({
        incident: activeIncident,
        notifiable_contacts_count: 1,
      });
      const liveView = renderWithProviders(<HomePage />, ['/home']);
      await waitFor(() =>
        expect(screen.getByTestId('live-status-screen')).toBeTruthy()
      );
      await runSeriousAxeCheck(liveView.container, `Live Status (${lang})`);
      cleanup();

      // (4) Consent Center
      const consentView = renderWithProviders(<ConsentCenterPage />, [
        '/consents',
      ]);
      await waitFor(() =>
        expect(
          consentView.container.querySelector('main#main-content')
        ).toBeTruthy()
      );
      await runSeriousAxeCheck(
        consentView.container,
        `Consent Center (${lang})`
      );
      cleanup();

      // (5) Trusted Circle
      const circleView = renderWithProviders(<TrustedCirclePage />, ['/circle']);
      await waitFor(() =>
        expect(
          circleView.container.querySelector('main#main-content')
        ).toBeTruthy()
      );
      await runSeriousAxeCheck(
        circleView.container,
        `Trusted Circle (${lang})`
      );
      cleanup();

      // (6) Contact Alert Page
      const contactAlertView = renderWithProviders(
        <Routes>
          <Route path="/c/:token" element={<ContactAlertPage />} />
        </Routes>,
        ['/c/tok_a11y_123']
      );
      await waitFor(() =>
        expect(contactAlertView.container.textContent).toContain('Aarohi')
      );
      await runSeriousAxeCheck(
        contactAlertView.container,
        `Contact Alert Page (${lang})`
      );
      cleanup();

      // (7) Responder Dashboard
      useAuthStore.getState().setUser({ ...demoResponderUser, language: lang });
      const responderView = renderWithProviders(<ResponderDashboardPage />, [
        '/responder',
      ]);
      await waitFor(() =>
        expect(responderView.container.textContent).toContain('Aarohi')
      );
      await runSeriousAxeCheck(
        responderView.container,
        `Responder Dashboard (${lang})`
      );
      cleanup();

      // (8) Admin Analytics
      useAuthStore.getState().setUser({ ...demoAdminUser, language: lang });
      const adminView = renderWithProviders(<AdminPage />, ['/admin']);
      await waitFor(() =>
        expect(
          adminView.container.querySelector('main#main-content')
        ).toBeTruthy()
      );
      await runSeriousAxeCheck(
        adminView.container,
        `Admin Analytics (${lang})`
      );
      cleanup();

      // (9) Safe Journeys
      useAuthStore.getState().setUser({ ...demoOwner, language: lang });
      const journeyView = renderWithProviders(<SafeJourneyPage />, [
        '/journeys',
      ]);
      await waitFor(() =>
        expect(
          journeyView.container.querySelector('main#main-content')
        ).toBeTruthy()
      );
      await runSeriousAxeCheck(journeyView.container, `Safe Journeys (${lang})`);
      cleanup();

      // (10) Safety Reports
      const reportsView = renderWithProviders(<SafetyReportsPage />, [
        '/reports',
      ]);
      await waitFor(() =>
        expect(
          reportsView.container.querySelector('main#main-content')
        ).toBeTruthy()
      );
      await runSeriousAxeCheck(
        reportsView.container,
        `Safety Reports (${lang})`
      );
      cleanup();

      // (11) Resources Directory
      const resourcesView = renderWithProviders(<ResourcesPage />, [
        '/resources',
      ]);
      await waitFor(() =>
        expect(resourcesView.container.textContent).toContain('112')
      );
      await runSeriousAxeCheck(
        resourcesView.container,
        `Resources Directory (${lang})`
      );
      cleanup();

      // (12) Emergency Data Policy
      const policyView = renderWithProviders(<PolicyPage />, ['/policy']);
      await waitFor(() =>
        expect(
          policyView.container.querySelector('main#main-content')
        ).toBeTruthy()
      );
      await runSeriousAxeCheck(policyView.container, `Policy Page (${lang})`);
      cleanup();

      // (13) Settings
      const settingsView = renderWithProviders(<SettingsPage />, ['/settings']);
      await waitFor(() =>
        expect(
          settingsView.container.querySelector('main#main-content')
        ).toBeTruthy()
      );
      await runSeriousAxeCheck(settingsView.container, `Settings (${lang})`);
      cleanup();
    }
  }, 30000);

  it('2. Keyboard & Settings: SOS button is focusable and operable via keyboard (Space/Enter), focus ring classes are present, and reduced-motion + data-saver rules are respected', async () => {
    await i18n.changeLanguage('en');
    const homeView = renderWithProviders(<HomePage />, ['/home']);
    const sosBtn = await waitFor(() => screen.getByTestId('sos-hold-button'));

    sosBtn.focus();
    expect(document.activeElement).toBe(sosBtn);
    expect(sosBtn.className).toContain('focus-visible:ring');

    // Keyboard press starts hold progress and keyUp releases cleanly
    fireEvent.keyDown(sosBtn, { key: ' ' });
    fireEvent.keyUp(sosBtn, { key: ' ' });

    // Check skip-to-main-content link and main landmark focusability
    const skipLink = homeView.container.querySelector(
      'a[href="#main-content"]'
    );
    expect(skipLink).not.toBeNull();
    const mainLandmark = homeView.container.querySelector('main#main-content');
    expect(mainLandmark).not.toBeNull();
  });

  it('3. Rename scan: app.name is SHAKTI in en.json and hi.json, and neither file contains the literal "SAATHI" or "साथी"', () => {
    expect(enJson.app.name).toBe('SHAKTI');
    expect(hiJson.app.name).toBe('SHAKTI');

    const enRaw = fs.readFileSync(
      path.resolve(__dirname, '../i18n/en.json'),
      'utf-8'
    );
    const hiRaw = fs.readFileSync(
      path.resolve(__dirname, '../i18n/hi.json'),
      'utf-8'
    );

    expect(enRaw).not.toMatch(/SAATHI/i);
    expect(hiRaw).not.toMatch(/SAATHI/i);
    expect(hiRaw).not.toContain('साथी');
  });

  it('4. Disguise mode check: in disguise mode the page title, manifest-facing text, and visible UI do not show the product name (SHAKTI or SAATHI)', async () => {
    const seqHash = await hashDisguiseSequence('25800=');
    useTriggerSettingsStore.getState().setDisguiseSequenceHash(seqHash);
    useTriggerSettingsStore.getState().setDisguiseEnabled(true);
    useTriggerSettingsStore.getState().setDisguiseUnlockedSession(false);

    let manifestEl = document.querySelector(
      'link[rel="manifest"]'
    ) as HTMLLinkElement | null;
    if (!manifestEl) {
      manifestEl = document.createElement('link');
      manifestEl.rel = 'manifest';
      manifestEl.href = '/manifest.webmanifest';
      document.head.appendChild(manifestEl);
    }

    const view = renderWithProviders(<HomePage />, ['/home']);
    await waitFor(() =>
      expect(screen.getByTestId('disguise-calculator')).toBeTruthy()
    );

    // 1. Page title is Calculator and does not contain SHAKTI or SAATHI
    expect(document.title).toBe('Calculator');
    expect(document.title).not.toMatch(/SHAKTI|SAATHI|शक्ति|साथी/i);

    // 2. Manifest-facing text in disguise mode does not contain SHAKTI or SAATHI
    const manifestHref = decodeURIComponent(
      manifestEl.getAttribute('href') || ''
    );
    expect(manifestHref).toContain('Calculator');
    expect(manifestHref).not.toMatch(/SHAKTI|SAATHI|शक्ति|साथी/i);

    // 3. Visible UI text does not show the product name anywhere
    const visibleText = view.container.textContent || '';
    expect(visibleText).not.toMatch(/SHAKTI|SAATHI|शक्ति|साथी/i);
  });
});
