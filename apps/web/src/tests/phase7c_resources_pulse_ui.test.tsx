import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import i18n from '../i18n';
import { ResourcesPage } from '../pages/ResourcesPage';
import { HomePage } from '../pages/HomePage';
import { useAuthStore } from '../store/authStore';
import { useTriggerSettingsStore } from '../store/triggerSettingsStore';
import {
  consentsApi,
  contactsApi,
  incidentsApi,
  resourcesPulseApi,
  type ResourceDto,
} from '../lib/api';

const MOCK_RESOURCES: ResourceDto[] = [
  {
    id: 'res_112',
    name: 'National Emergency Response Support System (ERSS)',
    category: 'emergency',
    phone: '112',
    description: 'Pan-India single emergency helpline for Police, Fire, and Ambulance.',
    available_hours: '24x7',
    active: true,
  },
  {
    id: 'res_181',
    name: 'Women Helpline',
    category: 'women_helpline',
    phone: '181',
    description: '24-hour toll-free helpline for women seeking support and referral.',
    available_hours: '24x7',
    active: true,
  },
  {
    id: 'res_osc',
    name: 'Sakhi One Stop Centre (Generic Entry)',
    category: 'one_stop_centre',
    phone: 'add your local number',
    description: 'Integrated support and assistance under one roof.',
    available_hours: '24x7 (add your local centre details)',
    active: true,
  },
  {
    id: 'res_campus_security',
    name: 'Campus Security Control Room (Editable Placeholder)',
    category: 'campus_security',
    phone: 'add your local number',
    description: 'Campus security desk for escorts and on-campus response.',
    available_hours: '24x7 (editable placeholder)',
    active: true,
  },
];

describe('SAATHI Phase 7C Web UI Tests — Resources Directory & Weekly Safety Pulse', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await i18n.changeLanguage('en');

    useAuthStore.setState({
      user: {
        id: 'u_demo_1',
        phone_e164: '+919000000001',
        name: 'Asha Sharma',
        role: 'user',
        language: 'en',
        created_at: new Date().toISOString(),
        
        
      },
      isLoading: false,
      darkMode: false,
    });

    useTriggerSettingsStore.setState({
      disguiseEnabled: false,
      disguiseUnlockedSession: false,
      lowPowerDataSaverMode: false,
    });

    vi.spyOn(consentsApi, 'getConsents').mockResolvedValue({
      current: {
        data_processing: true,
        location: false,
        notifications: true,
        camera: false,
        microphone: false,
        
        
      },
      history: [],
    });
    vi.spyOn(contactsApi, 'listContacts').mockResolvedValue({
      contacts: [],
      notifiable_contacts_count: 0,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('1. Resources Directory Page: renders seeded resources, filters by search and category, and provides 56px one-tap tel: links (English + Hindi)', async () => {
    const listSpy = vi
      .spyOn(resourcesPulseApi, 'listResources')
      .mockImplementation(async (params) => {
        const q = (params?.q || '').toLowerCase();
        const cat = params?.category || '';
        const filtered = MOCK_RESOURCES.filter((r) => {
          if (cat && r.category !== cat) return false;
          if (
            q &&
            !`${r.name} ${r.phone} ${r.description}`.toLowerCase().includes(q)
          ) {
            return false;
          }
          return true;
        });
        return { resources: filtered };
      });

    render(
      <MemoryRouter initialEntries={['/resources']}>
        <Routes>
          <Route path="/resources" element={<ResourcesPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('resources-list')).toBeInTheDocument();
    });

    // Verify 112 and 181 one-tap tel: links with 56px target class
    const tel112 = screen.getByTestId('resource-tel-link-res_112');
    expect(tel112).toHaveAttribute('href', 'tel:112');
    expect(tel112.className).toContain('min-h-[56px]');

    const tel181 = screen.getByTestId('resource-tel-link-res_181');
    expect(tel181).toHaveAttribute('href', 'tel:181');
    expect(tel181.className).toContain('min-h-[56px]');

    // Verify placeholder note is shown for non-112/181 entries
    expect(
      screen.getByTestId('resource-placeholder-note-res_osc')
    ).toBeInTheDocument();

    // Filter by category chip: women_helpline
    fireEvent.click(screen.getByTestId('resources-cat-chip-women_helpline'));
    await waitFor(() => {
      expect(listSpy).toHaveBeenLastCalledWith({
        q: undefined,
        category: 'women_helpline',
      });
      expect(screen.getByTestId('resource-card-res_181')).toBeInTheDocument();
      expect(
        screen.queryByTestId('resource-card-res_112')
      ).not.toBeInTheDocument();
    });

    // Reset category to All and search by text "Sakhi"
    fireEvent.click(screen.getByTestId('resources-cat-chip-all'));
    fireEvent.change(screen.getByTestId('resources-search-input'), {
      target: { value: 'Sakhi' },
    });

    await waitFor(() => {
      expect(listSpy).toHaveBeenLastCalledWith({
        q: 'Sakhi',
        category: undefined,
      });
      expect(screen.getByTestId('resource-card-res_osc')).toBeInTheDocument();
      expect(
        screen.queryByTestId('resource-card-res_181')
      ).not.toBeInTheDocument();
    });

    // Switch language to Hindi and verify translation
    await act(async () => {
      await i18n.changeLanguage('hi');
    });
    expect(
      screen.getByText(/सत्यापित हेल्पलाइन और सहायता निर्देशिका/)
    ).toBeInTheDocument();
  });

  it('2. Safety Pulse Card on Home: shown when eligible, supports two questions + anonymous submit or skip/dismiss, and is NEVER shown during an active alert or in disguise mode', async () => {
    vi.spyOn(incidentsApi, 'getActiveIncident').mockResolvedValue({
      incident: null,
      notifiable_contacts_count: 0,
    });
    vi.spyOn(resourcesPulseApi, 'getPulseStatus').mockResolvedValue({
      should_prompt: true,
      last_submitted_at: null,
      next_eligible_at: null,
    });
    const submitSpy = vi
      .spyOn(resourcesPulseApi, 'submitPulse')
      .mockResolvedValue({
        pulse: {
          id: 'p_1',
          safety_score: 5,
          avoided_going_somewhere: true,
          anonymous: true,
          created_at: '2026-10-06',
        },
      });

    const { unmount } = render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<HomePage />} />
        </Routes>
      </MemoryRouter>
    );

    // Wait for Home screen and pulse card
    await waitFor(() => {
      expect(screen.getByTestId('sos-hold-button')).toBeInTheDocument();
      expect(screen.getByTestId('safety-pulse-card')).toBeInTheDocument();
    });

    // Verify both exact questions are rendered
    expect(
      screen.getByText('How safe did you feel traveling this week? (1-5)')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Did you avoid going somewhere because of safety? (Yes/No)'
      )
    ).toBeInTheDocument();

    // Select score 5 and "Yes" for avoided going somewhere, then submit
    fireEvent.click(screen.getByTestId('pulse-score-5'));
    fireEvent.click(screen.getByTestId('pulse-avoided-yes'));
    fireEvent.click(screen.getByTestId('pulse-submit-btn'));

    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalledWith({
        safety_score: 5,
        avoided_going_somewhere: true,
        anonymous: true,
      });
      expect(screen.queryByTestId('safety-pulse-card')).not.toBeInTheDocument();
    });

    unmount();

    // Test dismissal: clear localStorage, re-render, and click Skip/Dismiss
    window.localStorage.clear();
    const { unmount: unmountDismiss } = render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<HomePage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('safety-pulse-card')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('pulse-skip-btn'));
    await waitFor(() => {
      expect(screen.queryByTestId('safety-pulse-card')).not.toBeInTheDocument();
    });
    unmountDismiss();

    // Test hidden during an active alert: even when localStorage is cleared and should_prompt=true
    window.localStorage.clear();
    vi.spyOn(incidentsApi, 'getActiveIncident').mockResolvedValue({
      incident: {
        id: 'inc_active_1',
        user_id: 'u_demo_1',
        status: 'ACTIVE',
        emergency_type: null,
        countdown_ends_at: null,
        auto_expire_minutes: 60,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        resolved_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any,
      notifiable_contacts_count: 0,
    });

    const { unmount: unmountActiveAlert } = render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<HomePage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('live-status-screen')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('safety-pulse-card')).not.toBeInTheDocument();
    unmountActiveAlert();

    // Test hidden while disguise mode is on
    vi.spyOn(incidentsApi, 'getActiveIncident').mockResolvedValue({
      incident: null,
      notifiable_contacts_count: 0,
    });
    useTriggerSettingsStore.setState({
      disguiseEnabled: true,
      disguiseSequenceHash: '1234=',
      disguiseUnlockedSession: false,
    });

    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<HomePage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(
        screen.queryByTestId('safety-pulse-card')
      ).not.toBeInTheDocument();
    });
  });
});
