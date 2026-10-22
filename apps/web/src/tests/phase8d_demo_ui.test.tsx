// @vitest-environment jsdom
import React from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../i18n';
import i18n from '../i18n';
import { HomePage } from '../pages/HomePage';
import { AdminPage } from '../pages/AdminPage';
import { WelcomePage } from '../pages/WelcomePage';
import { useAuthStore } from '../store/authStore';
import { useDemoStore } from '../store/demoStore';
import {
  ApiError,
  adminMetricsApi,
  consentsApi,
  contactsApi,
  demoApi,
  incidentsApi,
  resourcesPulseApi,
} from '../lib/api';

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  window.ResizeObserver =
    ResizeObserverMock as unknown as typeof ResizeObserver;
}

describe('Phase 8D: Demo Mode Banner, Simulate Panel & Analytics Badge (Web UI)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');

    useDemoStore.setState({
      checked: false,
      demoMode: false,
      status: null,
    });

    vi.spyOn(incidentsApi, 'getActiveIncident').mockResolvedValue({
      incident: null,
      notifiable_contacts_count: 2,
    });
    vi.spyOn(contactsApi, 'listContacts').mockResolvedValue({
      contacts: [],
      notifiable_contacts_count: 2,
    });
    vi.spyOn(consentsApi, 'getConsents').mockResolvedValue({
      current: {
        location: true,
        notifications: true,
        microphone: false,
        camera: false,
        data_processing: true,
      },
      history: [],
    });
    vi.spyOn(resourcesPulseApi, 'getPulseStatus').mockResolvedValue({
      should_prompt: false,
      last_submitted_at: '2026-10-08T00:00:00.000Z',
      next_eligible_at: '2026-10-15T00:00:00.000Z',
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('1. When DEMO_MODE is off (/api/demo/status returns 404), no Demo Mode banner, no Simulate panel, and no Includes demo data badge render', async () => {
    vi.spyOn(demoApi, 'getStatus').mockRejectedValue(
      new ApiError(404, 'Not found')
    );

    vi.spyOn(adminMetricsApi, 'getMetrics').mockResolvedValue({
      range: {
        from: '2026-09-08T00:00:00.000Z',
        to: '2026-10-08T00:00:00.000Z',
      },
      minimum_sample_size: 5,
      includes_demo_data: false,
      metrics: {
        alert_initiation_time: {
          metric: 'alert_initiation_time',
          value: null,
          n: 0,
          target: 'under 10 s',
          formula: 'median(server_created_at - client_created_at)',
          insufficient_data: true,
        },
        time_to_active: {
          metric: 'time_to_active',
          value: null,
          n: 0,
          target: 'informational',
          formula: 'median(activated_at - created_at)',
          insufficient_data: true,
        },
        notification_delivery_rate: {
          metric: 'notification_delivery_rate',
          value: null,
          n: 0,
          target: 'above 95%',
          formula: 'delivered / all',
          insufficient_data: true,
          by_channel: {},
        },
        time_to_first_acknowledgement: {
          metric: 'time_to_first_acknowledgement',
          value: null,
          n: 0,
          target: null,
          formula: 'first ack - active',
          insufficient_data: true,
        },
        time_to_resolution: {
          metric: 'time_to_resolution',
          value: null,
          n: 0,
          target: null,
          formula: 'resolved - active',
          insufficient_data: true,
        },
        cancellation_rate: {
          metric: 'cancellation_rate',
          value: null,
          n: 0,
          target: null,
          formula: 'cancelled / all',
          insufficient_data: true,
        },
        false_alarm_rate: {
          metric: 'false_alarm_rate',
          value: null,
          n: 0,
          target: null,
          formula: 'false_alarm / active',
          insufficient_data: true,
        },
        location_availability: {
          metric: 'location_availability',
          value: null,
          n: 0,
          target: null,
          formula: 'active with loc / active',
          insufficient_data: true,
        },
        audit_completeness: {
          metric: 'audit_completeness',
          value: null,
          n: 0,
          target: '100%',
          formula: 'valid chain / all',
          insufficient_data: true,
        },
        safety_pulse: {
          metric: 'safety_pulse',
          value: null,
          n: 0,
          target: null,
          formula: 'avg score',
          insufficient_data: true,
          by_week: [],
        },
        post_incident_trust_score: {
          metric: 'post_incident_trust_score',
          value: null,
          n: 0,
          target: null,
          formula: 'avg trust score',
          insufficient_data: true,
        },
      },
    });

    useAuthStore.setState({
      user: {
        id: 'user_demo_1',
        phone_e164: '+919000000001',
        name: 'Aarohi Sharma',
        role: 'user',
        language: 'en',
        organization_zone: 'Demo Campus Zone',
        cancel_window_seconds: 5,
        has_cancel_pin: false,
        has_duress_pin: false,
        created_at: '2026-10-08T00:00:00.000Z',
      },
      isLoading: false,
      darkMode: false,
      toasts: [],
    });

    const { unmount } = render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<HomePage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('sos-hold-button')).toBeTruthy();
    });

    expect(screen.queryByTestId('demo-mode-banner')).toBeNull();
    expect(screen.queryByTestId('demo-simulate-panel')).toBeNull();
    unmount();

    // Check AdminPage when DEMO_MODE is off
    useAuthStore.setState({
      user: {
        id: 'admin_1',
        phone_e164: '+919000000003',
        name: 'Meera Nair',
        role: 'admin',
        language: 'en',
        organization_zone: 'Demo Campus Zone',
        cancel_window_seconds: 5,
        has_cancel_pin: false,
        has_duress_pin: false,
        created_at: '2026-10-08T00:00:00.000Z',
      },
      isLoading: false,
      darkMode: false,
      toasts: [],
    });

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('admin-kpi-grid')).toBeTruthy();
    });

    expect(screen.queryByTestId('demo-mode-banner')).toBeNull();
    expect(screen.queryByTestId('demo-simulate-panel')).toBeNull();
    expect(screen.queryByTestId('admin-includes-demo-badge')).toBeNull();
    expect(screen.queryByTestId('admin-demo-reset-btn')).toBeNull();
  });

  it('2. When DEMO_MODE is on, the always-visible banner with mock-provider labels, Simulate panel, and Admin "Includes demo data" badge appear and trigger simulate endpoints', async () => {
    vi.spyOn(demoApi, 'getStatus').mockResolvedValue({
      demo_mode: true,
      banner: 'DEMO MODE: no real alerts are sent',
      providers: {
        sms: { name: 'MockSmsProvider', label: 'MOCK' },
        push: { name: 'MockPushProvider', label: 'MOCK' },
        gateway_112: { name: 'MockEmergencyGateway', label: 'MOCK' },
      },
    });

    const simContactSpy = vi
      .spyOn(demoApi, 'simulateContact')
      .mockResolvedValue({
        simulated: true,
        actor_type: 'contact',
        contact_id: 'demo_contact_priya_1',
        contact_name: 'Priya Verma (Sister)',
        action: 'seen',
        incident_id: 'inc_123',
        incident_status: 'ACKNOWLEDGED',
        summary: null,
      });

    const simRespSpy = vi
      .spyOn(demoApi, 'simulateResponder')
      .mockResolvedValue({
        simulated: true,
        actor_type: 'responder',
        action: 'acknowledge',
        incident_id: 'inc_123',
        incident_status: 'ACKNOWLEDGED',
        incident: {} as never,
      });

    // 1. Public Welcome screen shows DemoModeBanner
    useAuthStore.setState({
      user: null,
      isLoading: false,
      darkMode: false,
      toasts: [],
    });

    const { unmount: unmountWelcome } = render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<WelcomePage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('demo-mode-banner')).toBeTruthy();
    });
    expect(screen.getByTestId('demo-mode-banner-text').textContent).toContain(
      'DEMO MODE: no real alerts are sent'
    );
    expect(
      screen.getByTestId('demo-mode-mock-provider-labels').textContent
    ).toContain('MockSmsProvider');
    expect(
      screen.getByTestId('demo-mode-mock-provider-labels').textContent
    ).toContain('MockPushProvider');
    expect(
      screen.getByTestId('demo-mode-mock-provider-labels').textContent
    ).toContain('MockEmergencyGateway');
    unmountWelcome();

    // 2. Demo User HomePage shows both DemoModeBanner and DemoSimulatePanel
    useAuthStore.setState({
      user: {
        id: 'user_demo_1',
        phone_e164: '+919000000001',
        name: 'Aarohi Sharma',
        role: 'user',
        language: 'en',
        organization_zone: 'Demo Campus Zone',
        cancel_window_seconds: 5,
        has_cancel_pin: false,
        has_duress_pin: false,
        created_at: '2026-10-08T00:00:00.000Z',
      },
      isLoading: false,
      darkMode: false,
      toasts: [],
    });

    const { unmount: unmountHome } = render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<HomePage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('demo-simulate-panel')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('demo-sim-contact-seen-btn'));
    await waitFor(() => {
      expect(simContactSpy).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'seen' })
      );
    });

    fireEvent.click(screen.getByTestId('demo-sim-responder-ack-btn'));
    await waitFor(() => {
      expect(simRespSpy).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'acknowledge' })
      );
    });
    unmountHome();

    // 3. Admin Analytics page shows "Includes demo data" badge and Reset Demo Data button
    vi.spyOn(adminMetricsApi, 'getMetrics').mockResolvedValue({
      range: {
        from: '2026-09-08T00:00:00.000Z',
        to: '2026-10-08T00:00:00.000Z',
      },
      minimum_sample_size: 5,
      includes_demo_data: true,
      metrics: {
        alert_initiation_time: {
          metric: 'alert_initiation_time',
          value: 1.8,
          n: 6,
          target: 'under 10 s',
          formula: 'median(server_created_at - client_created_at)',
          insufficient_data: false,
        },
        time_to_active: {
          metric: 'time_to_active',
          value: 5,
          n: 5,
          target: 'informational',
          formula: 'median(activated_at - created_at)',
          insufficient_data: false,
        },
        notification_delivery_rate: {
          metric: 'notification_delivery_rate',
          value: 100,
          n: 15,
          target: 'above 95%',
          formula: 'delivered / all',
          insufficient_data: false,
          by_channel: {},
        },
        time_to_first_acknowledgement: {
          metric: 'time_to_first_acknowledgement',
          value: 20,
          n: 5,
          target: null,
          formula: 'first ack - active',
          insufficient_data: false,
        },
        time_to_resolution: {
          metric: 'time_to_resolution',
          value: 195,
          n: 5,
          target: null,
          formula: 'resolved - active',
          insufficient_data: false,
        },
        cancellation_rate: {
          metric: 'cancellation_rate',
          value: 16.67,
          n: 6,
          target: null,
          formula: 'cancelled / all',
          insufficient_data: false,
        },
        false_alarm_rate: {
          metric: 'false_alarm_rate',
          value: 0,
          n: 5,
          target: null,
          formula: 'false_alarm / active',
          insufficient_data: false,
        },
        location_availability: {
          metric: 'location_availability',
          value: 100,
          n: 5,
          target: null,
          formula: 'active with loc / active',
          insufficient_data: false,
        },
        audit_completeness: {
          metric: 'audit_completeness',
          value: 100,
          n: 6,
          target: '100%',
          formula: 'valid chain / all',
          insufficient_data: false,
        },
        safety_pulse: {
          metric: 'safety_pulse',
          value: 4.17,
          n: 6,
          target: null,
          formula: 'avg score',
          insufficient_data: false,
          by_week: [],
        },
        post_incident_trust_score: {
          metric: 'post_incident_trust_score',
          value: 4.6,
          n: 5,
          target: null,
          formula: 'avg trust score',
          insufficient_data: false,
        },
      },
    });

    useAuthStore.setState({
      user: {
        id: 'admin_1',
        phone_e164: '+919000000003',
        name: 'Meera Nair',
        role: 'admin',
        language: 'en',
        organization_zone: 'Demo Campus Zone',
        cancel_window_seconds: 5,
        has_cancel_pin: false,
        has_duress_pin: false,
        created_at: '2026-10-08T00:00:00.000Z',
      },
      isLoading: false,
      darkMode: false,
      toasts: [],
    });

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('admin-includes-demo-badge')).toBeTruthy();
    });
    expect(
      screen.getByTestId('admin-includes-demo-badge').textContent
    ).toContain('Includes demo data');
    expect(screen.getByTestId('admin-demo-reset-btn')).toBeTruthy();
  });
});
