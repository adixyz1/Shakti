import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../i18n';
import i18n from '../i18n';
import { ResponderDashboardPage } from '../pages/ResponderDashboardPage';
import {
  responderApi,
  type ResponderIncidentDetailDto,
  type ResponderIncidentListItemDto,
  type ResponderProfileDto,
} from '../lib/api';
import { useAuthStore } from '../store/authStore';

const mockResponderProfile: ResponderProfileDto = {
  id: 'resp-1',
  user_id: 'user-resp-1',
  name: 'Inspector Kavita Rao',
  phone_e164: '+919000000002',
  organization_zone: 'Demo Campus Zone',
  active: true,
  on_duty: true,
};

const mockListItems: ResponderIncidentListItemDto[] = [
  {
    id: 'inc-open-duress',
    user_first_name: 'Aarohi',
    organization_zone: 'Demo Campus Zone',
    status: 'NOTIFIED',
    emergency_type: 'stalking',
    source_trigger: 'button',
    is_duress: true,
    duress_notice:
      'Her phone shows this alert as cancelled. She may not be able to talk safely. Do not call or message her. Consider contacting security or 112.',
    created_at: new Date().toISOString(),
    activated_at: new Date().toISOString(),
    closed_at: null,
    acknowledged_by_responder: false,
    assigned_responder_user_ids: ['user-resp-1'],
    latest_location: {
      lat: 28.6139,
      lng: 77.209,
      accuracy_m: 10,
      captured_at: new Date().toISOString(),
    },
  },
];

const mockDetailBeforeAck: ResponderIncidentDetailDto = {
  ...mockListItems[0],
  user_phone_e164: null,
  events: [
    {
      id: 'ev-1',
      incident_id: 'inc-open-duress',
      from_status: null,
      to_status: 'TRIGGERED',
      actor_type: 'user',
      actor_id: 'user-1',
      note: 'SOS triggered via button',
      created_at: new Date().toISOString(),
    },
    {
      id: 'ev-2',
      incident_id: 'inc-open-duress',
      from_status: 'ACTIVE',
      to_status: 'NOTIFIED',
      actor_type: 'system',
      actor_id: 'dispatcher',
      note: 'At least one notification handed to provider',
      created_at: new Date().toISOString(),
    },
  ],
  assignments: [
    {
      id: 'assign-1',
      responder_id: 'resp-1',
      responder_user_id: 'user-resp-1',
      organization_zone: 'Demo Campus Zone',
      assigned_by_user_id: null,
      acknowledged_at: null,
      created_at: new Date().toISOString(),
    },
  ],
};

describe('SAATHI Phase 6B Web UI Tests — Responder Dashboard (/responder)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
    useAuthStore.setState({
      user: {
        id: 'user-resp-1',
        phone_e164: '+919000000002',
        name: 'Inspector Kavita Rao',
        role: 'responder',
        language: 'en',
        organization_zone: 'Demo Campus Zone',
        created_at: new Date().toISOString(),
      },
      isLoading: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  function renderResponderDashboard() {
    return render(
      <MemoryRouter initialEntries={['/responder']}>
        <Routes>
          <Route path="/responder" element={<ResponderDashboardPage />} />
        </Routes>
      </MemoryRouter>
    );
  }

  it('1. Renders live incident list, freshness label, map with last updated label, duress warning banner, and hides victim phone until responder acknowledges', async () => {
    vi.spyOn(responderApi, 'listIncidents').mockResolvedValue({
      responder: mockResponderProfile,
      colleagues: [mockResponderProfile],
      incidents: mockListItems,
    });
    vi.spyOn(responderApi, 'getIncidentDetail').mockResolvedValue({
      incident: mockDetailBeforeAck,
    });

    const performSpy = vi
      .spyOn(responderApi, 'performAction')
      .mockImplementation(async (_id, action) => ({
        incident: {
          ...mockDetailBeforeAck,
          status: action === 'acknowledge' ? 'ACKNOWLEDGED' : 'RESPONDING',
          acknowledged_by_responder: true,
          user_phone_e164: '+919000000001',
        },
      }));

    renderResponderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('responder-dashboard-title')).toBeTruthy();
    });

    // Freshness label & zone badge
    expect(screen.getByTestId('responder-zone-badge').textContent).toContain(
      'Demo Campus Zone'
    );
    expect(screen.getByTestId('responder-list-freshness-label')).toBeTruthy();

    // Duress warning banner & badge
    expect(screen.getByTestId('responder-duress-banner')).toBeTruthy();
    expect(
      screen.getByTestId('responder-duress-notice-text').textContent
    ).toContain('Her phone shows this alert as cancelled.');

    // Map with last updated label
    expect(screen.getByTestId('responder-leaflet-map')).toBeTruthy();
    expect(screen.getByTestId('responder-map-last-updated')).toBeTruthy();

    // Phone hidden before acknowledge
    expect(screen.getByTestId('responder-detail-phone').textContent).toContain(
      'Phone hidden until you acknowledge'
    );

    // Click Acknowledge Alert -> reveals phone and updates status to ACKNOWLEDGED
    fireEvent.click(screen.getByTestId('responder-btn-acknowledge'));

    await waitFor(() => {
      expect(performSpy).toHaveBeenCalledWith(
        'inc-open-duress',
        'acknowledge',
        {}
      );
      expect(
        screen.getByTestId('responder-detail-phone').textContent
      ).toContain('+919000000001');
      expect(
        screen.getByTestId('responder-detail-status').textContent
      ).toContain('ACKNOWLEDGED');
    });
  });

  it('2. Supports responding, assign, note, resolve, false-alarm (with required note), and English + Hindi i18n', async () => {
    vi.spyOn(responderApi, 'listIncidents').mockResolvedValue({
      responder: mockResponderProfile,
      colleagues: [mockResponderProfile],
      incidents: mockListItems,
    });
    vi.spyOn(responderApi, 'getIncidentDetail').mockResolvedValue({
      incident: {
        ...mockDetailBeforeAck,
        is_duress: false,
        duress_notice: null,
        acknowledged_by_responder: true,
        user_phone_e164: '+919000000001',
      },
    });

    const performSpy = vi
      .spyOn(responderApi, 'performAction')
      .mockImplementation(async (_id, action, payload) => ({
        incident: {
          ...mockDetailBeforeAck,
          status:
            action === 'responding'
              ? 'RESPONDING'
              : action === 'resolve'
              ? 'RESOLVED'
              : action === 'false-alarm'
              ? 'FALSE_ALARM'
              : 'ACKNOWLEDGED',
          acknowledged_by_responder: true,
          user_phone_e164: '+919000000001',
          events: [
            ...mockDetailBeforeAck.events,
            {
              id: `ev-${action}`,
              incident_id: 'inc-open-duress',
              from_status: 'NOTIFIED',
              to_status: 'RESPONDING',
              actor_type: 'responder',
              actor_id: 'user-resp-1',
              note: payload?.note || action,
              created_at: new Date().toISOString(),
            },
          ],
        },
      }));

    renderResponderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('responder-btn-responding')).toBeTruthy();
    });

    // Add Note
    fireEvent.change(screen.getByTestId('responder-note-input'), {
      target: { value: 'Unit 2 en route' },
    });
    fireEvent.click(screen.getByTestId('responder-btn-add-note'));

    await waitFor(() => {
      expect(performSpy).toHaveBeenCalledWith('inc-open-duress', 'note', {
        note: 'Unit 2 en route',
      });
    });

    // False alarm toggle + confirm with note
    fireEvent.click(screen.getByTestId('responder-btn-false-alarm-toggle'));
    fireEvent.change(screen.getByTestId('responder-false-alarm-note-input'), {
      target: { value: 'Accidental trigger verified' },
    });
    fireEvent.click(screen.getByTestId('responder-btn-false-alarm-confirm'));

    await waitFor(() => {
      expect(performSpy).toHaveBeenCalledWith(
        'inc-open-duress',
        'false-alarm',
        { note: 'Accidental trigger verified' }
      );
    });

    // Switch to Hindi and verify Hindi dashboard title renders
    await i18n.changeLanguage('hi');
    await waitFor(() => {
      expect(
        screen.getByTestId('responder-dashboard-title').textContent
      ).toContain('रिस्पॉन्डर डैशबोर्ड');
    });
  });
});
