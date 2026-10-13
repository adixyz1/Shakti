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

const openDuressItem: ResponderIncidentListItemDto = {
  id: 'inc-open-1',
  user_first_name: 'Aarohi',
  organization_zone: 'Demo Campus Zone',
  status: 'NOTIFIED',
  emergency_type: 'stalking',
  source_trigger: 'button',
  is_duress: true,
  duress_notice:
    'Her phone shows this alert as cancelled. She may not be able to talk safely. Do not call or message her. Consider contacting security or 112.',
  created_at: new Date(Date.now() - 15_000).toISOString(),
  activated_at: new Date(Date.now() - 12_000).toISOString(),
  closed_at: null,
  acknowledged_by_responder: false,
  assigned_responder_user_ids: ['user-resp-1'],
  latest_location: {
    lat: 28.6139,
    lng: 77.209,
    accuracy_m: 10,
    captured_at: new Date().toISOString(),
  },
};

const closedItem: ResponderIncidentListItemDto = {
  id: 'inc-closed-2',
  user_first_name: 'Meera',
  organization_zone: 'Demo Campus Zone',
  status: 'RESOLVED',
  emergency_type: 'unsafe_ride',
  source_trigger: 'button',
  is_duress: false,
  duress_notice: null,
  created_at: new Date(Date.now() - 600_000).toISOString(),
  activated_at: new Date(Date.now() - 595_000).toISOString(),
  closed_at: new Date(Date.now() - 300_000).toISOString(),
  acknowledged_by_responder: true,
  assigned_responder_user_ids: ['user-resp-1'],
  latest_location: null,
};

const openDuressDetail: ResponderIncidentDetailDto = {
  ...openDuressItem,
  user_phone_e164: null,
  mock_112_gateway: {
    is_mock: true,
    label: 'MOCK',
    provider: 'MockEmergencyGateway',
    status: 'standby',
    reference_id: null,
  },
  events: [],
  assignments: [
    {
      id: 'assign-1',
      responder_id: 'resp-1',
      responder_user_id: 'user-resp-1',
      organization_zone: 'Demo Campus Zone',
      assigned_by_user_id: null,
      acknowledged_at: null,
      created_at: new Date(Date.now() - 12_000).toISOString(),
    },
  ],
};

describe('SAATHI Phase 6B Verification Gap Tests (Web UI)', () => {
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

  it('1. Verifies status filter (l), response timer stopping on acknowledge (m), duress banner "Silent alert: do not contact her directly." (n), and Mock 112 gateway status labeled MOCK (q)', async () => {
    vi.spyOn(responderApi, 'listIncidents').mockResolvedValue({
      responder: mockResponderProfile,
      colleagues: [mockResponderProfile],
      incidents: [openDuressItem, closedItem],
    });
    vi.spyOn(responderApi, 'getIncidentDetail').mockResolvedValue({
      incident: openDuressDetail,
    });
    vi.spyOn(responderApi, 'performAction').mockResolvedValue({
      incident: {
        ...openDuressDetail,
        status: 'ACKNOWLEDGED',
        acknowledged_by_responder: true,
        user_phone_e164: '+919000000001',
        assignments: [
          {
            ...openDuressDetail.assignments[0],
            acknowledged_at: new Date().toISOString(),
          },
        ],
      },
    });

    render(
      <MemoryRouter initialEntries={['/responder']}>
        <Routes>
          <Route path="/responder" element={<ResponderDashboardPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('responder-incident-list')).toBeTruthy();
    });

    // (l) Incident list & status filter: ALL shows both (2), OPEN shows only openDuressItem, CLOSED shows only closedItem
    expect(screen.getByTestId('responder-incident-item-inc-open-1')).toBeTruthy();
    expect(
      screen.getByTestId('responder-incident-item-inc-closed-2')
    ).toBeTruthy();

    fireEvent.click(screen.getByTestId('responder-filter-open'));
    expect(screen.getByTestId('responder-incident-item-inc-open-1')).toBeTruthy();
    expect(
      screen.queryByTestId('responder-incident-item-inc-closed-2')
    ).toBeNull();

    fireEvent.click(screen.getByTestId('responder-filter-closed'));
    expect(
      screen.queryByTestId('responder-incident-item-inc-open-1')
    ).toBeNull();
    expect(
      screen.getByTestId('responder-incident-item-inc-closed-2')
    ).toBeTruthy();

    fireEvent.click(screen.getByTestId('responder-filter-all'));

    // (n) Duress banner shows "Silent alert: do not contact her directly."
    const duressBanner = screen.getByTestId('responder-duress-banner');
    expect(duressBanner.textContent).toContain(
      'Silent alert: do not contact her directly.'
    );

    // (q) Mock 112 gateway status shown and labeled MOCK
    expect(
      screen.getByTestId('responder-mock-112-status').textContent
    ).toContain('MockEmergencyGateway');
    expect(
      screen.getByTestId('responder-mock-112-badge').textContent
    ).toBe('MOCK');

    // (m) Response timer is running before acknowledge, and stops on acknowledge
    const timerBefore = screen.getByTestId('responder-response-timer');
    expect(timerBefore.getAttribute('data-timer-state')).toBe('running');
    expect(timerBefore.textContent).toContain('(running)');

    fireEvent.click(screen.getByTestId('responder-btn-acknowledge'));

    await waitFor(() => {
      const timerAfter = screen.getByTestId('responder-response-timer');
      expect(timerAfter.getAttribute('data-timer-state')).toBe('stopped');
      expect(timerAfter.textContent).toContain('(stopped on acknowledge)');
    });
  });
});
