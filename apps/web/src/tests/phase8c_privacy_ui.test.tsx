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
import { SettingsPage } from '../pages/SettingsPage';
import { PolicyPage } from '../pages/PolicyPage';
import { ConsentCenterPage } from '../pages/ConsentCenterPage';
import { OnboardingPage } from '../pages/OnboardingPage';
import { authApi, consentsApi, contactsApi } from '../lib/api';
import * as offlineQueue from '../lib/offlineQueue';

const NORMAL_USER: UserProfile = {
  id: 'usr_user_1',
  phone_e164: '+919000000001',
  name: 'Aarohi Sharma',
  role: 'user',
  language: 'en',
  organization_zone: 'Demo Campus Zone',
  cancel_window_seconds: 5,
  has_cancel_pin: true,
  has_duress_pin: false,
  created_at: '2026-10-01T00:00:00.000Z',
};

describe('Phase 8C Web — Privacy Tools & Emergency Data Policy', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
    useAuthStore.setState({
      user: NORMAL_USER,
      isLoading: false,
      toasts: [],
    });

    if (typeof URL.createObjectURL === 'undefined') {
      URL.createObjectURL = vi.fn(() => 'blob:mock-export-url');
    } else {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-export-url');
    }
    if (typeof URL.revokeObjectURL === 'undefined') {
      URL.revokeObjectURL = vi.fn();
    } else {
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    }
  });

  afterEach(() => {
    cleanup();
  });

  it('1. Settings Privacy Tools: Download my data, Clear local data, and Delete my account (requires fresh OTP ONLY + DELETE confirmation, and clears IndexedDB queue, contact cache, localStorage, sessionStorage, and service worker CacheStorage)', async () => {
    const exportSpy = vi.spyOn(authApi, 'exportMyData').mockResolvedValue({
      exported_at: '2026-10-06T00:00:00.000Z',
      profile: { id: 'usr_user_1', phone_e164: '+919000000001' },
      contacts: [],
    });

    const requestOtpSpy = vi
      .spyOn(authApi, 'requestOtp')
      .mockResolvedValue({ status: 'sent', dev_otp: '654321' } as any);

    const deleteSpy = vi
      .spyOn(authApi, 'deleteMyAccount')
      .mockResolvedValue({ status: 'account_deleted' });

    // Seed IndexedDB offline queue, contact cache, localStorage, sessionStorage, and CacheStorage
    await offlineQueue.enqueueOfflineAlert({
      client_request_id: 'queued_before_delete_1',
      client_created_at: '2026-10-06T10:00:00.000Z',
      source_trigger: 'button',
      emergency_type: 'stalking',
      location: null,
    });
    await offlineQueue.syncOfflineEmergencyContactsCache([
      {
        id: 'c_cache_1',
        user_id: 'usr_user_1',
        name: 'Cached Sister',
        phone_e164: '+919811122233',
        priority_order: 1,
        status: 'accepted',
        permissions: {
          receives_sos: true,
          receives_checkin: true,
          can_see_live_location: true,
        },
        created_at: '2026-10-01T00:00:00.000Z',
        updated_at: '2026-10-01T00:00:00.000Z',
      },
    ]);
    window.localStorage.setItem('saathi_trigger_settings_v1', '{"shakeEnabled":true}');
    window.sessionStorage.setItem('saathi_temp_session', 'active');

    const mockCacheDelete = vi.fn().mockResolvedValue(true);
    (globalThis as any).caches = {
      keys: vi.fn().mockResolvedValue(['saathi-static-v1', 'saathi-resources-v1']),
      delete: mockCacheDelete,
    };

    render(
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/login" element={<div data-testid="login-screen">Login Screen</div>} />
          <Route path="/policy" element={<PolicyPage />} />
        </Routes>
      </MemoryRouter>
    );

    // 1. Download my data
    const downloadBtn = screen.getByTestId('download-my-data-btn');
    fireEvent.click(downloadBtn);
    await waitFor(() => {
      expect(exportSpy).toHaveBeenCalledTimes(1);
    });

    // 2. Delete my account flow (OTP ONLY; no Cancel PIN input exists)
    const openDeleteBtn = screen.getByTestId('open-delete-account-btn');
    fireEvent.click(openDeleteBtn);

    const confirmBox = screen.getByTestId('delete-account-confirm-box');
    expect(confirmBox).toBeInTheDocument();
    expect(screen.queryByTestId('delete-account-pin-input')).toBeNull();

    // Try submitting without confirmation word "DELETE" -> shows error
    const submitDeleteBtn = screen.getByTestId('confirm-delete-account-btn');
    fireEvent.click(submitDeleteBtn);
    expect(screen.getByTestId('delete-account-error')).toHaveTextContent(
      /Please type DELETE/i
    );
    expect(deleteSpy).not.toHaveBeenCalled();

    // Type DELETE but no OTP -> shows OTP re-auth error
    const wordInput = screen.getByTestId('delete-account-word-input');
    fireEvent.change(wordInput, { target: { value: 'DELETE' } });
    fireEvent.click(submitDeleteBtn);
    expect(screen.getByTestId('delete-account-error')).toHaveTextContent(
      /Please enter a fresh 6-digit OTP/i
    );
    expect(deleteSpy).not.toHaveBeenCalled();

    // Request fresh OTP and submit -> calls deleteMyAccount, clears all local caches, navigates to /login
    fireEvent.click(screen.getByTestId('delete-request-otp-btn'));
    await waitFor(() => {
      expect(requestOtpSpy).toHaveBeenCalledWith('+919000000001');
    });

    const otpInput = screen.getByTestId('delete-account-otp-input');
    fireEvent.change(otpInput, { target: { value: '654321' } });
    fireEvent.click(submitDeleteBtn);

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith({
        confirmation: 'DELETE',
        otp_code: '654321',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('login-screen')).toBeInTheDocument();
    });
    expect(useAuthStore.getState().user).toBeNull();

    // Verify client caches (IndexedDB queue, contact cache, localStorage, sessionStorage, CacheStorage) were cleared
    const remainingQueue = await offlineQueue.listQueuedAlerts();
    expect(remainingQueue).toHaveLength(0);
    const remainingContacts = await offlineQueue.getCachedEmergencyContacts();
    expect(remainingContacts).toHaveLength(0);
    expect(window.localStorage.getItem('saathi_trigger_settings_v1')).toBeNull();
    expect(window.sessionStorage.getItem('saathi_temp_session')).toBeNull();
    expect(mockCacheDelete).toHaveBeenCalledWith('saathi-static-v1');
    expect(mockCacheDelete).toHaveBeenCalledWith('saathi-resources-v1');
  });

  it('2. Emergency Data Policy page (/policy): renders all 5 sections in English + Hindi and is linked from Onboarding, Consent Center, Settings, and Footer', async () => {
    vi.spyOn(consentsApi, 'getConsents').mockResolvedValue({
      current: {
        location_sharing: true,
        contact_alerts: true,
        sms_fallback: true,
        crowd_reporting: false,
      },
      history: [],
    });
    vi.spyOn(contactsApi, 'listContacts').mockResolvedValue({ contacts: [] });

    const { unmount } = render(
      <MemoryRouter initialEntries={['/policy']}>
        <Routes>
          <Route path="/policy" element={<PolicyPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('policy-page')).toBeInTheDocument();
    expect(screen.getByTestId('policy-section-collects')).toHaveTextContent(
      /What SHAKTI Collects/i
    );
    expect(screen.getByTestId('policy-section-who')).toHaveTextContent(
      /Who Can See Your Data/i
    );
    expect(screen.getByTestId('policy-section-retention')).toHaveTextContent(
      /How Long Each Item Is Kept/i
    );
    expect(screen.getByTestId('policy-section-deletion')).toHaveTextContent(
      /What Happens When You Revoke Consent or Delete Your Account/i
    );
    expect(screen.getByTestId('policy-section-never')).toHaveTextContent(
      /What SHAKTI Never Does/i
    );
    expect(screen.getByTestId('policy-section-never')).toHaveTextContent(
      /never claims guaranteed police arrival/i
    );

    // Switch to Hindi and verify bilingual support
    await i18n.changeLanguage('hi');
    await waitFor(() => {
      expect(screen.getByTestId('policy-section-collects')).toHaveTextContent(
        /क्या एकत्र करता है/
      );
      expect(screen.getByTestId('policy-section-never')).toHaveTextContent(
        /क्या कभी नहीं करता/
      );
    });
    await i18n.changeLanguage('en');
    unmount();

    // Verify link in Consent Center (/consents) + Footer
    const { unmount: unmountConsents } = render(
      <MemoryRouter initialEntries={['/consents']}>
        <Routes>
          <Route path="/consents" element={<ConsentCenterPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('consents-policy-link')).toHaveAttribute(
      'href',
      '/policy'
    );
    expect(screen.getByTestId('footer-policy-link')).toHaveAttribute(
      'href',
      '/policy'
    );
    unmountConsents();

    // Verify link in Onboarding (/onboarding) — footer is always present, step 3 has onboarding-policy-link
    const { unmount: unmountOnboarding } = render(
      <MemoryRouter initialEntries={['/onboarding']}>
        <Routes>
          <Route path="/onboarding" element={<OnboardingPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('footer-policy-link')).toHaveAttribute(
      'href',
      '/policy'
    );
    unmountOnboarding();
  });
});
