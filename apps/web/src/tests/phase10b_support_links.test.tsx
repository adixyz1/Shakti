import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '../i18n';
import { HomePage } from '../pages/HomePage';
import { ResourcesPage, sortResourcesForSupport } from '../pages/ResourcesPage';
import { ContactAlertPage } from '../pages/ContactAlertPage';
import { ResponderDashboardPage } from '../pages/ResponderDashboardPage';
import { ClosedAlertSupportCard } from '../components/ClosedAlertSupportCard';
import { useAuthStore } from '../store/authStore';
import { useTriggerSettingsStore } from '../store/triggerSettingsStore';
import * as apiModule from '../lib/api';

const mockUser: any = {
  id: 'usr_test_10b',
  phone_e164: '+919000000001',
  name: 'Pooja Verma',
  role: 'user',
  language: 'en',
  created_at: new Date().toISOString(),
  cancel_window_seconds: 5,
  has_cancel_pin: false,
  has_duress_pin: true,
};

const makeMockIncident = (status: string, isDuress = false): apiModule.IncidentDto => ({
  id: 'inc_test_10b',
  user_id: 'usr_test_10b',
  client_request_id: 'req_10b',
  emergency_type: 'sos',
  status: status as any,
  source_trigger: 'button',
  is_duress: isDuress,
  escalation_stage: 0,
  needs_user_action: false,
  created_at: new Date().toISOString(),
  activated_at: new Date().toISOString(),
  closed_at: new Date().toISOString(),
  merged_into_id: null,
  auto_expire_minutes: 60,
});

const MOCK_API_RESOURCES: apiModule.ResourceDto[] = [
  {
    id: 'res_112_erss',
    name: '112 Emergency Response Support System',
    category: 'emergency',
    phone: '112',
    description: 'All-in-one emergency dispatch.',
    available_hours: '24x7',
    active: true,
  },
  {
    id: 'res_campus',
    name: 'Campus Security',
    category: 'campus_security',
    phone: 'add your local number',
    description: 'Campus control desk.',
    available_hours: '24x7',
    active: true,
  },
  {
    id: 'res_counseling',
    name: 'Student & Community Counseling',
    category: 'counseling',
    phone: '14416',
    description: 'Mental health support.',
    available_hours: '24x7',
    active: true,
  },
  {
    id: 'res_legal_aid',
    name: 'District Legal Services Authority',
    category: 'legal_aid',
    phone: '15100',
    description: 'Free legal aid.',
    available_hours: '24x7',
    active: true,
  },
  {
    id: 'res_one_stop',
    name: 'Sakhi One Stop Centre (OSC)',
    category: 'one_stop_centre',
    phone: 'add your local number',
    description: 'Integrated crisis support.',
    available_hours: '24x7',
    active: true,
  },
  {
    id: 'res_181_helpline',
    name: '181 Women Helpline',
    category: 'women_helpline',
    phone: '181',
    description: '24-hour women helpline.',
    available_hours: '24x7',
    active: true,
  },
];

describe('Phase 10B: Calm Support Links on Closed-Alert Screens', () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.changeLanguage('en');

    useAuthStore.getState().setUser(mockUser);
    useTriggerSettingsStore.getState().resetTriggerSettings();

    vi.spyOn(apiModule.contactsApi, 'listContacts').mockResolvedValue({
      contacts: [],
      notifiable_contacts_count: 0,
    } as any);

    vi.spyOn(apiModule.consentsApi, 'getConsents').mockResolvedValue({
      current: { data_processing: true, location: false },
    } as any);

    vi.spyOn(apiModule.resourcesPulseApi, 'listResources').mockResolvedValue({
      resources: MOCK_API_RESOURCES,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // 1. Identical text and card across resolved, cancelled, expired, and masked duress views
  it('1. Shows calm support card with IDENTICAL text and position for resolved, cancelled, expired, and masked duress views', async () => {
    // A. RESOLVED
    vi.spyOn(apiModule.incidentsApi, 'getActiveIncident').mockResolvedValue({
      incident: makeMockIncident('RESOLVED', false),
    } as any);

    const { rerender } = render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('closed-status-screen')).toBeInTheDocument();
    });

    const cardResolved = screen.getByTestId('closed-alert-support-card');
    expect(cardResolved).toBeInTheDocument();
    const resolvedText = cardResolved.textContent?.trim();
    expect(resolvedText).toContain('Need someone to talk to?');
    expect(resolvedText).toContain('See support options');

    const linkResolved = screen.getByTestId('support-options-link');
    expect(linkResolved).toHaveAttribute('href', '/resources');
    expect(linkResolved.className).toContain('min-h-[56px]');

    // B. CANCELLED
    vi.spyOn(apiModule.incidentsApi, 'getActiveIncident').mockResolvedValue({
      incident: makeMockIncident('CANCELLED', false),
    } as any);

    rerender(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('closed-status-screen')).toBeInTheDocument();
    });

    const cardCancelled = screen.getByTestId('closed-alert-support-card');
    expect(cardCancelled.textContent?.trim()).toBe(resolvedText);

    // C. EXPIRED
    vi.spyOn(apiModule.incidentsApi, 'getActiveIncident').mockResolvedValue({
      incident: makeMockIncident('EXPIRED', false),
    } as any);

    rerender(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('closed-status-screen')).toBeInTheDocument();
    });

    const cardExpired = screen.getByTestId('closed-alert-support-card');
    expect(cardExpired.textContent?.trim()).toBe(resolvedText);

    // D. MASKED DURESS "CANCELLED" VIEW (isDuress is true internally, but masked status is CANCELLED)
    vi.spyOn(apiModule.incidentsApi, 'getActiveIncident').mockResolvedValue({
      incident: makeMockIncident('CANCELLED', true),
    } as any);

    rerender(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('closed-status-screen')).toBeInTheDocument();
    });

    const cardDuress = screen.getByTestId('closed-alert-support-card');
    expect(cardDuress.textContent?.trim()).toBe(resolvedText);

    // Strict invariant: duress cannot be told apart by the support card
    expect(cardDuress.textContent?.trim()).toEqual(cardResolved.textContent?.trim());
    expect(cardDuress.textContent?.trim()).toEqual(cardCancelled.textContent?.trim());
    expect(cardDuress.textContent?.trim()).toEqual(cardExpired.textContent?.trim());
  });

  // 2. Hidden while an alert is active or when idle
  it('2. Hidden during active alerts (TRIGGERED, ACTIVE, NOTIFIED, ACKNOWLEDGED, RESPONDING) and idle state', async () => {
    const activeStatuses = ['TRIGGERED', 'ACTIVE', 'NOTIFIED', 'ACKNOWLEDGED', 'RESPONDING', 'ESCALATED'];

    for (const status of activeStatuses) {
      vi.spyOn(apiModule.incidentsApi, 'getActiveIncident').mockResolvedValue({
        incident: makeMockIncident(status, false),
      } as any);

      const { unmount } = render(
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      );

      expect(screen.queryByTestId('closed-alert-support-card')).not.toBeInTheDocument();
      unmount();
    }

    // Idle state (no active incident)
    vi.spyOn(apiModule.incidentsApi, 'getActiveIncident').mockResolvedValue({
      incident: null,
    } as any);

    const { unmount: unmountIdle } = render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    expect(screen.queryByTestId('closed-alert-support-card')).not.toBeInTheDocument();
    unmountIdle();
  });

  // 3. Not added to contact or responder pages
  it('3. Not present on Contact Alert page or Responder Dashboard page', async () => {
    // Contact page
    const { unmount: unmountContact } = render(
      <MemoryRouter initialEntries={['/contact/test-token']}>
        <Routes>
          <Route path="/contact/:token" element={<ContactAlertPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByTestId('closed-alert-support-card')).not.toBeInTheDocument();
    unmountContact();

    // Responder dashboard page
    const { unmount: unmountResp } = render(
      <MemoryRouter initialEntries={['/responder']}>
        <Routes>
          <Route path="/responder" element={<ResponderDashboardPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByTestId('closed-alert-support-card')).not.toBeInTheDocument();
    unmountResp();
  });

  // 4. Offline fallback shows 181 and 112 from local constants
  it('4. Offline fallback: displays 181 and 112 call links from local constants with 56px targets', async () => {
    // Card with offline fallback
    render(
      <MemoryRouter>
        <ClosedAlertSupportCard forceOffline={true} />
      </MemoryRouter>
    );

    expect(screen.getByTestId('offline-support-fallback')).toBeInTheDocument();

    const call181 = screen.getByTestId('support-call-181');
    expect(call181).toHaveAttribute('href', 'tel:181');
    expect(call181.className).toContain('min-h-[56px]');

    const call112 = screen.getByTestId('support-call-112');
    expect(call112).toHaveAttribute('href', 'tel:112');
    expect(call112.className).toContain('min-h-[56px]');

    // Offline on ResourcesPage
    vi.spyOn(apiModule.resourcesPulseApi, 'listResources').mockRejectedValue(
      new Error('Network error (offline)')
    );

    const { unmount: unmountResources } = render(
      <MemoryRouter initialEntries={['/resources']}>
        <Routes>
          <Route path="/resources" element={<ResourcesPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('resources-list')).toBeInTheDocument();
    });

    // 181 and 112 local constants are shown on ResourcesPage when offline
    expect(screen.getByTestId('resource-tel-link-res_offline_181')).toHaveAttribute('href', 'tel:181');
    expect(screen.getByTestId('resource-tel-link-res_offline_112')).toHaveAttribute('href', 'tel:112');
    unmountResources();
  });

  // 5. Resources ordering: counseling, legal-aid, One Stop Centre and 181 entries first
  it('5. Resources ordering: counseling, legal-aid, One Stop Centre, and 181 entries are listed first', () => {
    const sorted = sortResourcesForSupport(MOCK_API_RESOURCES);

    // Verify ranks: counseling (1st), legal-aid (2nd), One Stop Centre (3rd), 181 (4th)
    expect(sorted[0].category).toBe('counseling');
    expect(sorted[1].category).toBe('legal_aid');
    expect(sorted[2].category).toBe('one_stop_centre');
    expect(sorted[3].phone).toBe('181');

    // Remaining items (emergency 112, campus security) follow after
    const remainingCategories = sorted.slice(4).map((r) => r.category);
    expect(remainingCategories).toContain('emergency');
    expect(remainingCategories).toContain('campus_security');
  });

  // 6. Hindi strings
  it('6. Hindi strings: renders calm support card, 181, and 112 in Hindi without missing keys', async () => {
    await act(async () => {
      await i18n.changeLanguage('hi');
    });

    render(
      <MemoryRouter>
        <ClosedAlertSupportCard forceOffline={true} />
      </MemoryRouter>
    );

    const card = screen.getByTestId('closed-alert-support-card');
    expect(card.textContent).toContain('क्या आपको किसी से बात करने की ज़रूरत है?');
    expect(card.textContent).toContain('सहायता विकल्प देखें');
    expect(card.textContent).toContain('181 पर कॉल करें');
    expect(card.textContent).toContain('112 पर कॉल करें');
  });

  // 7. Hidden in disguise mode
  it('7. Hidden in disguise mode: does not render when disguise mode is active', () => {
    useTriggerSettingsStore.getState().setDisguiseSequenceHash('pbkdf2$200000$00$00$6');
    useTriggerSettingsStore.getState().setDisguiseEnabled(true);
    useTriggerSettingsStore.getState().setDisguiseUnlockedSession(false);

    render(
      <MemoryRouter>
        <ClosedAlertSupportCard />
      </MemoryRouter>
    );

    expect(screen.queryByTestId('closed-alert-support-card')).not.toBeInTheDocument();
  });
});
