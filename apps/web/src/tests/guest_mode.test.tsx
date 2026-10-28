import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '../i18n';
import { AppRoutes } from '../App';
import { HomePage } from '../pages/HomePage';
import { SettingsPage } from '../pages/SettingsPage';
import { useAuthStore } from '../store/authStore';
import { useTriggerSettingsStore } from '../store/triggerSettingsStore';
import * as apiModule from '../lib/api';
import { triggerSos } from '../lib/sos';
import {
  addGuestEmergencyContact,
  getGuestEmergencyContacts,
  getCachedEmergencyContacts,
  syncOfflineEmergencyContactsCache,
  clearOfflineEmergencyContactsCache,
  clearAllOfflineStateOnLogout,
  removeGuestEmergencyContact,
  clearAllDeviceData,
  MAX_GUEST_CONTACTS,
} from '../lib/offlineQueue';

describe('Guest Mode: Complete Suite', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    localStorage.clear();
    sessionStorage.clear();
    await clearAllDeviceData();
    useAuthStore.getState().setUser(null);
    useAuthStore.getState().setLoading(false);
    useTriggerSettingsStore.getState().resetTriggerSettings();
    void i18n.changeLanguage('en');

    // Mock authApi.getMe to reject for unauthenticated guest
    vi.spyOn(apiModule.authApi, 'getMe').mockRejectedValue(new Error('Unauthenticated'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allows guest to access Home page without redirect to login', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <AppRoutes />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Should render Home page and SOS button, not redirected to /login
    await waitFor(() => {
      expect(screen.getByTestId('sos-hold-button')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();
  });

  it('renders AccountRequiredPage for account-required routes without redirect loops', async () => {
    // Test Circle (requires account)
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/circle']}>
          <AppRoutes />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('account-required-page')).toBeInTheDocument();
      expect(screen.getByTestId('account-required-signin-btn')).toBeInTheDocument();
      expect(screen.getByTestId('account-required-home-btn')).toBeInTheDocument();
    });
    unmount();

    // Test Journeys (requires account)
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/journeys']}>
          <AppRoutes />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('account-required-page')).toBeInTheDocument();
      expect(screen.getByTestId('account-required-reason')).toBeInTheDocument();
    });
  });

  it('executes Guest SOS with NO POST /api/incidents network call', async () => {
    const createIncidentSpy = vi.spyOn(apiModule.incidentsApi, 'createIncident');

    const result = await triggerSos('button');

    // Crucial check: zero POST /api/incidents
    expect(createIncidentSpy).not.toHaveBeenCalled();
    expect(result.incident.id).toMatch(/^guest_/);
    expect(result.incident.status).toBe('TRIGGERED');
    expect(result.queued_offline).toBe(false);
  });

  it('renders guest active SOS screen with Call 112, Call 181, and SMS fallback note', async () => {
    // Add a local emergency contact first
    await addGuestEmergencyContact({
      name: 'Priya Sharma',
      phone_e164: '+919876543210',
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('sos-hold-button')).toBeInTheDocument();
    });

    // Trigger Guest SOS
    await act(async () => {
      await triggerSos('button');
    });

    // Cancel window screen appears
    await waitFor(() => {
      expect(screen.getByTestId('cancel-window-screen')).toBeInTheDocument();
    });

    // Cancel alert via button
    const cancelBtn = screen.getByTestId('cancel-alert-btn');
    await act(async () => {
      fireEvent.click(cancelBtn);
    });

    await waitFor(() => {
      expect(screen.getByTestId('closed-status-screen')).toBeInTheDocument();
    });
  });

  it('hides silent duress PIN settings and displays account-required note in Guest Mode', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/settings']}>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('pin-settings-card')).toBeInTheDocument();
    });

    // Cancel PIN is available on device
    expect(screen.getByTestId('open-cancel-pin-setup-btn')).toBeInTheDocument();

    // Duress PIN setup button is hidden for guests
    expect(screen.queryByTestId('open-duress-pin-setup-btn')).not.toBeInTheDocument();
    expect(screen.getByTestId('duress-guest-notice')).toBeInTheDocument();
  });

  it('manages guest emergency contacts in IndexedDB and enforces 5-contact limit', async () => {
    // Initially empty
    let contacts = await getGuestEmergencyContacts();
    expect(contacts).toHaveLength(0);

    // Add contacts up to MAX_GUEST_CONTACTS (5)
    for (let i = 1; i <= 5; i++) {
      await addGuestEmergencyContact({
        name: `Contact ${i}`,
        phone_e164: `+91900000000${i}`,
      });
    }

    contacts = await getGuestEmergencyContacts();
    expect(contacts).toHaveLength(5);

    // Attempting to add a 6th contact must reject
    await expect(
      addGuestEmergencyContact({
        name: 'Contact 6',
        phone_e164: '+919000000006',
      })
    ).rejects.toThrow(/maximum/i);

    // Remove one contact
    await removeGuestEmergencyContact(contacts[0].id);
    contacts = await getGuestEmergencyContacts();
    expect(contacts).toHaveLength(4);

    // Clear all device data
    await clearAllDeviceData();
    contacts = await getGuestEmergencyContacts();
    expect(contacts).toHaveLength(0);
  });

  it('configures and verifies device-only cancel PIN using PBKDF2 hash', async () => {
    const store = useTriggerSettingsStore.getState();

    // Set PIN
    await store.configureGuestCancelPin('4321');
    expect(useTriggerSettingsStore.getState().guestCancelPinHash).not.toBeNull();

    // Verify correct PIN
    const isValid = await store.verifyGuestCancelPin('4321');
    expect(isValid).toBe(true);

    // Verify wrong PIN
    const isInvalid = await store.verifyGuestCancelPin('9999');
    expect(isInvalid).toBe(false);

    // Clear PIN
    store.clearGuestCancelPin();
    expect(useTriggerSettingsStore.getState().guestCancelPinHash).toBeNull();
  });

  it('permissions for guests: SOS include location requests GPS only on user tap and updates SMS link', async () => {
    const getCurrentPositionMock = vi.fn((success) => {
      success({
        coords: {
          latitude: 28.6139,
          longitude: 77.209,
          accuracy: 12,
        },
      });
    });

    Object.defineProperty(global.navigator, 'geolocation', {
      value: { getCurrentPosition: getCurrentPositionMock },
      configurable: true,
      writable: true,
    });

    await addGuestEmergencyContact({
      name: 'Sister',
      phone_e164: '+919876543211',
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('sos-hold-button')).toBeInTheDocument();
    });

    // Crucial: no location prompt fired on mount
    expect(getCurrentPositionMock).not.toHaveBeenCalled();

    // Trigger guest SOS
    await act(async () => {
      await triggerSos('button');
    });

    // Wait for SMS fallback panel
    await waitFor(() => {
      expect(screen.getByTestId('sms-fallback-panel')).toBeInTheDocument();
      expect(screen.getByTestId('guest-include-location-btn')).toBeInTheDocument();
    });

    // Before tapping, no GPS call was made
    expect(getCurrentPositionMock).not.toHaveBeenCalled();

    // Tap "Include my location" button
    const includeLocBtn = screen.getByTestId('guest-include-location-btn');
    await act(async () => {
      fireEvent.click(includeLocBtn);
    });

    // Now GPS was requested exactly once on user gesture tap
    expect(getCurrentPositionMock).toHaveBeenCalledTimes(1);

    // Badge appears showing coordinates
    await waitFor(() => {
      expect(screen.getByTestId('guest-location-included-badge')).toBeInTheDocument();
    });

    // SMS link includes coordinates
    const smsLink = screen.getByTestId('sms-fallback-group-link') as HTMLAnchorElement;
    expect(decodeURIComponent(smsLink.href)).toContain('28.6139');
    expect(decodeURIComponent(smsLink.href)).toContain('77.209');
  });

  it('permissions for guests: guest settings displays local permissions section with open-app note and no auto prompt', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/settings']}>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('guest-permissions-section')).toBeInTheDocument();
    });

    // Shows notes that they work only while the app is open
    expect(screen.getByTestId('guest-shake-permission-card')).toBeInTheDocument();
    expect(screen.getByTestId('guest-voice-permission-card')).toBeInTheDocument();
    expect(screen.getByTestId('guest-shake-status')).toHaveTextContent(/not enabled/i);
    expect(screen.getByTestId('guest-voice-status')).toHaveTextContent(/not enabled/i);

    // Tap grant motion button
    const grantMotionBtn = screen.getByTestId('guest-grant-motion-btn');
    await act(async () => {
      fireEvent.click(grantMotionBtn);
    });

    await waitFor(() => {
      expect(screen.getByTestId('guest-shake-status')).toHaveTextContent(/enabled/i);
    });

    // Tap grant mic button
    const grantMicBtn = screen.getByTestId('guest-grant-mic-btn');
    await act(async () => {
      fireEvent.click(grantMicBtn);
    });

    await waitFor(() => {
      expect(screen.getByTestId('guest-voice-status')).toHaveTextContent(/enabled/i);
    });
  });

  it('data separation: guest contacts and account cache are separate across sign in, sign out, and sign in as another user', async () => {
    // 1. In guest mode, save a guest contact
    await addGuestEmergencyContact({
      name: 'Guest Friend',
      phone_e164: '+919999999999',
    });

    let guestList = await getGuestEmergencyContacts();
    let accountCache = await getCachedEmergencyContacts();
    expect(guestList).toHaveLength(1);
    expect(guestList[0].name).toBe('Guest Friend');
    expect(accountCache).toHaveLength(0); // Account cache is empty

    // 2. User 1 signs in and syncs their account contacts
    const user1Contacts = [
      {
        id: 'u1_c1',
        user_id: 'u1',
        name: 'User One Mom',
        phone_e164: '+919111111111',
        relationship: 'family',
        priority_order: 1,
        status: 'accepted' as const,
        permissions: { receives_sos: true, receives_checkin: true, can_see_live_location: true },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];
    await syncOfflineEmergencyContactsCache(user1Contacts, true);

    accountCache = await getCachedEmergencyContacts();
    guestList = await getGuestEmergencyContacts();
    expect(accountCache).toHaveLength(1);
    expect(accountCache[0].name).toBe('User One Mom');
    // Guest contacts must NOT be overwritten or combined into account cache
    expect(guestList).toHaveLength(1);
    expect(guestList[0].name).toBe('Guest Friend');

    // 3. User 1 signs out: account cache cleared, offline queue cleared, guest contacts intact
    await clearAllOfflineStateOnLogout();

    accountCache = await getCachedEmergencyContacts();
    guestList = await getGuestEmergencyContacts();
    expect(accountCache).toHaveLength(0); // Account cache cleared!
    expect(guestList).toHaveLength(1); // Guest contact NOT deleted on user logout!
    expect(guestList[0].name).toBe('Guest Friend'); // Account contact was NOT copied into guest list!

    // 4. User 2 signs in and syncs their account contacts
    const user2Contacts = [
      {
        id: 'u2_c1',
        user_id: 'u2',
        name: 'User Two Colleague',
        phone_e164: '+919222222222',
        relationship: 'colleague',
        priority_order: 1,
        status: 'accepted' as const,
        permissions: { receives_sos: true, receives_checkin: true, can_see_live_location: true },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];
    await syncOfflineEmergencyContactsCache(user2Contacts, true);

    accountCache = await getCachedEmergencyContacts();
    guestList = await getGuestEmergencyContacts();
    expect(accountCache).toHaveLength(1);
    expect(accountCache[0].name).toBe('User Two Colleague');
    // Guest contact still distinct
    expect(guestList).toHaveLength(1);
    expect(guestList[0].name).toBe('Guest Friend');
  });

  it('guest on account-only pages: visiting /circle, /journeys or /settings/data makes zero authenticated API calls and no refresh attempts', async () => {
    const listContactsSpy = vi.spyOn(apiModule.contactsApi, 'listContacts');
    const getActiveJourneySpy = vi.spyOn(apiModule.journeysApi, 'getActive');
    const getConsentsSpy = vi.spyOn(apiModule.consentsApi, 'getConsents');
    const apiRequestSpy = vi.spyOn(apiModule, 'apiRequest');

    // Visit /circle as guest
    const { unmount: unmount1 } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/circle']}>
          <AppRoutes />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('account-required-page')).toBeInTheDocument();
    });

    expect(listContactsSpy).not.toHaveBeenCalled();
    unmount1();

    // Visit /journeys as guest
    const { unmount: unmount2 } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/journeys']}>
          <AppRoutes />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('account-required-page')).toBeInTheDocument();
    });

    expect(getActiveJourneySpy).not.toHaveBeenCalled();
    unmount2();

    // Visit /settings/data as guest
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/settings/data']}>
          <AppRoutes />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('account-required-page')).toBeInTheDocument();
    });

    expect(getConsentsSpy).not.toHaveBeenCalled();

    // Verify ZERO calls were made to protected endpoints or refresh
    const authCalls = apiRequestSpy.mock.calls.filter(([path]) =>
      path.startsWith('/contacts') ||
      path.startsWith('/journeys') ||
      path.startsWith('/consents') ||
      path.startsWith('/auth/refresh') ||
      path.startsWith('/incidents')
    );
    expect(authCalls).toHaveLength(0);
  });
});
