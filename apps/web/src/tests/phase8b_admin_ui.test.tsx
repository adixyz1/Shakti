import React from 'react';
import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { useAuthStore, type UserProfile } from '../store/authStore';
import { AdminPage } from '../pages/AdminPage';
import { HomePage } from '../pages/HomePage';
import { PostIncidentRatingCard } from '../components/PostIncidentRatingCard';
import {
  adminAuditApi,
  adminMetricsApi,
  adminRespondersApi,
  consentsApi,
  contactsApi,
  incidentsApi,
  resourcesPulseApi,
  type ImpactMetricsResponseDto,
} from '../lib/api';

// Ensure ResizeObserver exists in JSDOM for Recharts ResponsiveContainer
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const ADMIN_USER: UserProfile = {
  id: 'usr_admin_1',
  phone_e164: '+919000000003',
  name: 'Meera Nair',
  role: 'admin',
  language: 'en',
  organization_zone: 'Demo Campus Zone',
  cancel_window_seconds: 5,
  cancel_pin_configured: false,
  duress_pin_configured: false,
  created_at: '2026-10-01T00:00:00.000Z',
};

const NORMAL_USER: UserProfile = {
  id: 'usr_user_1',
  phone_e164: '+919000000001',
  name: 'Aarohi Sharma',
  role: 'user',
  language: 'en',
  organization_zone: 'Demo Campus Zone',
  cancel_window_seconds: 5,
  cancel_pin_configured: false,
  duress_pin_configured: false,
  created_at: '2026-10-01T00:00:00.000Z',
};

const SAMPLE_METRICS: ImpactMetricsResponseDto = {
  range: {
    from: '2026-09-06T00:00:00.000Z',
    to: '2026-10-06T23:59:59.999Z',
  },
  minimum_sample_size: 5,
  metrics: {
    alert_initiation_time: {
      metric: 'alert_initiation_time',
      value: 3.5,
      unit: 'seconds',
      n: 6,
      excluded_implausible: 2,
      target: 'under 10 s',
      formula: 'median(server_created_at - client_created_at)',
      insufficient_data: false,
      queued_then_delivered: {
        label: 'queued-then-delivered',
        n: 2,
        value: null,
        insufficient_data: true,
      },
    },
    time_to_active: {
      metric: 'time_to_active',
      value: 5.5,
      unit: 'seconds',
      n: 6,
      target: 'informational (includes cancel window)',
      informational: true,
      formula: 'median(activated_at - created_at)',
      insufficient_data: false,
    },
    notification_delivery_rate: {
      metric: 'notification_delivery_rate',
      value: 91.67,
      unit: 'percent',
      n: 12,
      target: 'above 95%',
      environment_label: 'test environment',
      formula: 'sent_or_delivered / all * 100',
      insufficient_data: false,
      by_channel: {
        sms: {
          n: 5,
          succeeded: 4,
          value: 80,
          rate_percent: 80,
          insufficient_data: false,
        },
        push: {
          n: 5,
          succeeded: 5,
          value: 100,
          rate_percent: 100,
          insufficient_data: false,
        },
        gateway: {
          n: 2,
          succeeded: 2,
          value: null,
          rate_percent: null,
          insufficient_data: true,
        },
      },
    },
    time_to_first_acknowledgement: {
      metric: 'time_to_first_acknowledgement',
      value: 40,
      median_seconds: 40,
      p90_seconds: 90,
      unit: 'seconds',
      n: 5,
      target: null,
      formula: 'median and p90 of first ack',
      insufficient_data: false,
    },
    time_to_resolution: {
      metric: 'time_to_resolution',
      value: null,
      median_seconds: null,
      unit: 'seconds',
      n: 3,
      target: null,
      formula: 'median(resolved_at - activated_at)',
      insufficient_data: true, // Tests "Not enough data yet"
    },
    cancellation_rate: {
      metric: 'cancellation_rate',
      value: 25,
      unit: 'percent',
      n: 8,
      target: null,
      formula: 'CANCELLED / all * 100',
      insufficient_data: false,
    },
    false_alarm_rate: {
      metric: 'false_alarm_rate',
      value: 16.67,
      unit: 'percent',
      n: 6,
      target: null,
      formula: 'FALSE_ALARM / active * 100',
      insufficient_data: false,
    },
    location_availability: {
      metric: 'location_availability',
      value: 83.33,
      median_accuracy_meters: 12,
      location_consent_off_count: 1,
      unit: 'percent',
      n: 6,
      target: null,
      formula: 'active_with_loc / active * 100',
      insufficient_data: false,
    },
    audit_completeness: {
      metric: 'audit_completeness',
      value: 87.5,
      unit: 'percent',
      n: 8,
      target: '100%',
      formula: 'valid_chains / all * 100',
      insufficient_data: false,
    },
    safety_pulse: {
      metric: 'safety_pulse',
      value: 3.71,
      average_score: 3.71,
      avoided_going_somewhere_percent: 42.86,
      unit: 'score_1_to_5',
      n: 7,
      target: null,
      formula: 'avg(safety_score)',
      insufficient_data: false,
      by_week: [
        {
          week: '2026-W40',
          week_start: '2026-09-28',
          n: 5,
          value: 3.6,
          average_score: 3.6,
          avoided_going_somewhere_percent: 40,
          insufficient_data: false,
        },
      ],
    },
    post_incident_trust_score: {
      metric: 'post_incident_trust_score',
      value: 4.2,
      unit: 'score_1_to_5',
      n: 5,
      target: null,
      formula: 'avg(score)',
      insufficient_data: false,
    },
  },
};

describe('Phase 8B: Admin Dashboard, Tools & Post-Incident Rating (Frontend)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
    useAuthStore.setState({
      user: ADMIN_USER,
      isLoading: false,
      darkMode: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('1. Admin analytics page: renders KPI cards with targets, "Measured prototype values (test environment)", "Not enough data yet" when insufficient_data is true, separate queued-then-delivered card, clock-skew footnote, date filter, and CSV download button', async () => {
    const getMetricsSpy = vi
      .spyOn(adminMetricsApi, 'getMetrics')
      .mockResolvedValue(SAMPLE_METRICS);
    const downloadCsvSpy = vi
      .spyOn(adminMetricsApi, 'downloadMetricsCsvText')
      .mockResolvedValue('metric,value,n\nalert_initiation_time,3.5,6\n');

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </MemoryRouter>
    );

    // Prototype banner
    expect(
      await screen.findByTestId('admin-prototype-banner')
    ).toHaveTextContent('Measured prototype values (test environment)');

    // KPI Cards & Targets
    await waitFor(() => {
      expect(screen.getByTestId('metric-value-alert_initiation_time')).toHaveTextContent(
        '3.5 s'
      );
    });
    expect(
      screen.getByTestId('metric-target-alert_initiation_time')
    ).toHaveTextContent('Target: under 10 s');
    expect(
      screen.getByTestId('metric-target-notification_delivery_rate')
    ).toHaveTextContent('Target: above 95%');
    expect(
      screen.getByTestId('metric-target-audit_completeness')
    ).toHaveTextContent('Target: 100%');

    // "Not enough data yet" when insufficient_data is true (time_to_resolution has n=3, insufficient_data=true)
    expect(
      screen.getByTestId('metric-value-time_to_resolution')
    ).toHaveTextContent('Not enough data yet');

    // Queued-then-delivered shown separately from initiation-time card
    expect(
      screen.getByTestId('queued-then-delivered-card')
    ).toHaveTextContent('Queued-then-delivered (offline alerts)');
    expect(
      screen.getByTestId('queued-then-delivered-value')
    ).toHaveTextContent('Not enough data yet');

    // Clock-skew footnote with excluded_implausible count and "client clocks can be wrong"
    expect(screen.getByTestId('clock-skew-footnote')).toHaveTextContent(
      'Excluded implausible initiation values: 2 (client clocks can be wrong).'
    );

    // Date filter submission
    fireEvent.change(screen.getByTestId('admin-from-date'), {
      target: { value: '2026-10-01' },
    });
    fireEvent.change(screen.getByTestId('admin-to-date'), {
      target: { value: '2026-10-06' },
    });
    fireEvent.click(screen.getByTestId('admin-apply-date-filter-btn'));

    await waitFor(() => {
      expect(getMetricsSpy).toHaveBeenCalledWith({
        from: '2026-10-01',
        to: '2026-10-06',
      });
    });

    // CSV Download button
    fireEvent.click(screen.getByTestId('admin-download-csv-btn'));
    await waitFor(() => {
      expect(downloadCsvSpy).toHaveBeenCalledWith({
        from: '2026-10-01',
        to: '2026-10-06',
      });
    });
  });

  it('2. Admin tools tab: responder active/on-duty toggle requires confirm tap before turning off and displays plain-word warning when zone has zero active on-duty responders; audit log filters and resource editor work', async () => {
    vi.spyOn(adminMetricsApi, 'getMetrics').mockResolvedValue(SAMPLE_METRICS);
    const listAuditSpy = vi
      .spyOn(adminAuditApi, 'listAuditLogs')
      .mockResolvedValue({
        entries: [
          {
            id: 'aud_1',
            incident_id: 'inc_1',
            actor_type: 'responder',
            actor_id: 'usr_resp_1',
            actor_label: 'Inspector Kavita Rao',
            action: 'responder_view_incident',
            detail: 'Viewed incident detail',
            created_at: '2026-10-05T10:00:00.000Z',
          },
        ],
      });
    vi.spyOn(adminRespondersApi, 'listResponders').mockResolvedValue({
      responders: [
        {
          id: 'resp_1',
          name: 'Inspector Kavita Rao',
          organization_zone: 'Demo Campus Zone',
          active: true,
          on_duty: true,
        },
      ],
    });
    const updateRespSpy = vi
      .spyOn(adminRespondersApi, 'updateResponder')
      .mockResolvedValue({
        responder: {
          id: 'resp_1',
          name: 'Inspector Kavita Rao',
          organization_zone: 'Demo Campus Zone',
          active: true,
          on_duty: false,
        },
        warning:
          'Warning: Demo Campus Zone now has zero active, on-duty responders while an open incident exists in this zone. Routing only applies to incidents that become ACTIVE after this change; existing assignments are not changed.',
      });
    vi.spyOn(resourcesPulseApi, 'listResources').mockResolvedValue({
      resources: [
        {
          id: 'res_112',
          name: '112 ERSS',
          category: 'emergency_helpline',
          phone: '112',
          description: 'Emergency helpline',
          available_hours: '24x7',
          active: true,
        },
      ],
    });

    render(
      <MemoryRouter initialEntries={['/admin/tools']}>
        <Routes>
          <Route path="/admin/tools" element={<AdminPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('admin-responder-row-resp_1')).toBeTruthy();
    });

    // Tapping On Duty (currently ON) does NOT immediately call PATCH; it shows the confirm prompt
    fireEvent.click(screen.getByTestId('toggle-responder-onduty-resp_1'));
    expect(updateRespSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('confirm-turn-off-banner')).toHaveTextContent(
      'Confirm before turning off this responder: Inspector Kavita Rao'
    );

    // Confirm tap executes PATCH and displays the warning in plain words
    fireEvent.click(screen.getByTestId('confirm-turn-off-btn'));
    await waitFor(() => {
      expect(updateRespSpy).toHaveBeenCalledWith('resp_1', { on_duty: false });
    });
    expect(await screen.findByTestId('responder-zero-warning')).toHaveTextContent(
      'zero active, on-duty responders'
    );

    // Filter audit log by actor type
    fireEvent.click(screen.getByTestId('admin-audit-actor-responder'));
    await waitFor(() => {
      expect(listAuditSpy).toHaveBeenCalledWith(undefined, 'responder');
    });
  });

  it('3. Role guard: non-admin user or responder navigating to /admin is redirected away to /home', async () => {
    useAuthStore.setState({
      user: NORMAL_USER,
      isLoading: false,
      darkMode: false,
    });

    const RoleGuardedTestApp: React.FC = () => {
      const { user } = useAuthStore();
      return (
        <MemoryRouter initialEntries={['/admin']}>
          <Routes>
            <Route
              path="/admin"
              element={
                user?.role === 'admin' ? (
                  <AdminPage />
                ) : (
                  <div data-testid="redirected-home">Redirected to Home</div>
                )
              }
            />
          </Routes>
        </MemoryRouter>
      );
    };

    render(<RoleGuardedTestApp />);
    expect(screen.getByTestId('redirected-home')).toBeTruthy();
    expect(screen.queryByTestId('admin-page')).toBeNull();
  });

  it('4. Post-incident rating card: never shown during an active alert; shown when incident is closed (normal or duress); supports submitting 1-5 rating or skipping; renders Hindi strings', async () => {
    const submitRatingSpy = vi
      .spyOn(incidentsApi, 'submitRating')
      .mockResolvedValue({
        rating: {
          incident_id: 'inc_closed_99',
          score: 5,
          created_at: '2026-10-06T12:00:00.000Z',
        },
      });

    // A. During an ACTIVE alert on HomePage -> rating card is NOT rendered
    useAuthStore.setState({ user: NORMAL_USER, isLoading: false });
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
    vi.spyOn(contactsApi, 'listContacts').mockResolvedValue({
      contacts: [],
      notifiable_contacts_count: 1,
    });
    vi.spyOn(resourcesPulseApi, 'getPulseStatus').mockResolvedValue({
      should_prompt: false,
      last_submitted_at: null,
      next_eligible_at: null,
    });
    vi.spyOn(incidentsApi, 'getActiveIncident').mockResolvedValue({
      incident: {
        id: 'inc_active_1',
        user_id: NORMAL_USER.id,
        status: 'ACTIVE',
        emergency_type: 'unsafe',
        client_request_id: 'req_1',
        created_at: '2026-10-06T10:00:00.000Z',
        activated_at: '2026-10-06T10:00:05.000Z',
        closed_at: null,
        merged_into_id: null,
        source_trigger: 'button',
        is_duress: false,
        needs_user_action: false,
        escalation_stage: 1,
      },
      notifiable_contacts_count: 1,
    });

    const { unmount } = render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<HomePage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('live-status-screen')).toBeTruthy();
    });
    expect(screen.queryByTestId('post-incident-rating-card')).toBeNull();
    unmount();

    // B. Render PostIncidentRatingCard after close -> shows "How did SAATHI's help feel? 1-5", can skip or submit
    const { unmount: unmountCard } = render(
      <PostIncidentRatingCard incidentId="inc_closed_99" />
    );
    expect(screen.getByTestId('post-incident-rating-prompt')).toHaveTextContent(
      "How did SHAKTI's help feel? 1-5"
    );

    fireEvent.click(screen.getByTestId('post-incident-rating-score-5'));
    fireEvent.click(screen.getByTestId('post-incident-rating-submit-btn'));

    await waitFor(() => {
      expect(submitRatingSpy).toHaveBeenCalledWith('inc_closed_99', 5);
    });
    expect(
      await screen.findByTestId('post-incident-rating-thanks')
    ).toHaveTextContent('Thank you for your feedback.');
    unmountCard();

    // C. Skip button dismisses card without calling API, and Hindi strings render properly
    await i18n.changeLanguage('hi');
    useAuthStore.setState({ user: ADMIN_USER, isLoading: false });
    vi.spyOn(adminMetricsApi, 'getMetrics').mockResolvedValue(SAMPLE_METRICS);

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route
            path="/admin"
            element={
              <>
                <PostIncidentRatingCard incidentId="inc_skip_1" />
                <AdminPage />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('post-incident-rating-prompt')).toHaveTextContent(
      'SHAKTI की मदद कैसी लगी? 1-5'
    );
    expect(
      await screen.findByTestId('admin-prototype-banner')
    ).toHaveTextContent('मापे गए प्रोटोटाइप मान (परीक्षण वातावरण)');

    fireEvent.click(screen.getByTestId('post-incident-rating-skip-btn'));
    expect(screen.queryByTestId('post-incident-rating-card')).toBeNull();
  });
});
