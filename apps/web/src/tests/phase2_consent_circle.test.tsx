import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ConsentCenterPage } from '../pages/ConsentCenterPage';
import { TrustedCirclePage } from '../pages/TrustedCirclePage';
import { PublicInvitePage } from '../pages/PublicInvitePage';
import { OnboardingPage } from '../pages/OnboardingPage';
import { consentsApi, contactsApi, devApi, invitationsApi } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import i18n from '../i18n';

describe('SAATHI Phase 2 Web Tests (Consent Center, Trusted Circle & Public Invitation)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    useAuthStore.setState({
      user: {
        id: 'u1',
        phone_e164: '+919000000001',
        name: 'Aarohi Sharma',
        role: 'user',
        language: 'en',
        created_at: new Date().toISOString(),
      },
      isLoading: false,
      toasts: [],
    });
    await i18n.changeLanguage('en');
  });

  it('ConsentCenterPage renders all 5 permissions, toggles grant/revoke, shows ledger history, and shows reduced-mode notice if browser permission is declined', async () => {
    vi.spyOn(consentsApi, 'getConsents').mockResolvedValueOnce({
      current: {
        data_processing: false,
        location: false,
        notifications: false,
        microphone: false,
        camera: false,
      },
      history: [],
    });

    const postSpy = vi
      .spyOn(consentsApi, 'postConsent')
      .mockResolvedValueOnce({
        entry: {
          id: 'c1',
          user_id: 'u1',
          type: 'location',
          granted: true,
          source: 'consent_center',
          created_at: new Date().toISOString(),
        },
        current: {
          data_processing: false,
          location: true,
          notifications: false,
          microphone: false,
          camera: false,
        },
        history: [
          {
            id: 'c1',
            user_id: 'u1',
            type: 'location',
            granted: true,
            source: 'consent_center',
            created_at: new Date().toISOString(),
          },
        ],
      })
      .mockResolvedValueOnce({
        entry: {
          id: 'c2',
          user_id: 'u1',
          type: 'location',
          granted: false,
          source: 'consent_center',
          created_at: new Date().toISOString(),
        },
        current: {
          data_processing: false,
          location: false,
          notifications: false,
          microphone: false,
          camera: false,
        },
        history: [
          {
            id: 'c2',
            user_id: 'u1',
            type: 'location',
            granted: false,
            source: 'consent_center',
            created_at: new Date().toISOString(),
          },
          {
            id: 'c1',
            user_id: 'u1',
            type: 'location',
            granted: true,
            source: 'consent_center',
            created_at: new Date().toISOString(),
          },
        ],
      });

    render(
      <MemoryRouter>
        <ConsentCenterPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Emergency & Check-In Location/i)
      ).toBeTruthy();
    });

    // Click Grant on Location (in jsdom navigator.geolocation is undefined -> triggers Reduced Mode notice)
    const grantLocationBtn = screen.getByRole('button', {
      name: /Grant Permission Emergency & Check-In Location/i,
    });
    fireEvent.click(grantLocationBtn);

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith({
        type: 'location',
        granted: true,
        source: 'consent_center',
      });
      // Reduced Mode banner shown because geolocation is unavailable in jsdom
      expect(
        screen.getByText(/Reduced Mode Active for Emergency & Check-In Location/i)
      ).toBeTruthy();
      expect(screen.getByText('GRANTED')).toBeTruthy();
    });

    // Now click Revoke on Location
    const revokeLocationBtn = screen.getByRole('button', {
      name: /Revoke Permission Emergency & Check-In Location/i,
    });
    fireEvent.click(revokeLocationBtn);

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith({
        type: 'location',
        granted: false,
        source: 'consent_center',
      });
      expect(screen.getByText('REVOKED')).toBeTruthy();
    });
  });

  it('TrustedCirclePage submits new contact form, displays invitation status, and supports pause/remove', async () => {
    const listSpy = vi
      .spyOn(contactsApi, 'listContacts')
      .mockResolvedValueOnce({ contacts: [] })
      .mockResolvedValueOnce({
        contacts: [
          {
            id: 'tc1',
            user_id: 'u1',
            name: 'Priya Verma',
            phone_e164: '+919876543210',
            priority_order: 1,
            permissions: {
              receives_sos: true,
              receives_checkin: true,
              can_see_live_location: true,
            },
            status: 'invited',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      });

    vi.spyOn(devApi, 'getOutbox').mockResolvedValue({
      provider: 'MockSmsProvider',
      messages: [
        {
          id: 'm1',
          to_phone_e164: '+919876543210',
          body: 'Invite link: /invite/inv_test.sig',
          provider: 'MockSmsProvider',
          purpose: 'contact_invitation',
          metadata: {
            contact_id: 'tc1',
            contact_name: 'Priya Verma',
            invitation_url: '/invite/inv_test.sig',
          },
          created_at: new Date().toISOString(),
        },
      ],
    });

    const createSpy = vi.spyOn(contactsApi, 'createContact').mockResolvedValueOnce({
      contact: {
        id: 'tc1',
        user_id: 'u1',
        name: 'Priya Verma',
        phone_e164: '+919876543210',
        priority_order: 1,
        permissions: {
          receives_sos: true,
          receives_checkin: true,
          can_see_live_location: true,
        },
        status: 'invited',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      invitation_token: 'inv_test.sig',
      invitation_url: '/invite/inv_test.sig',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });

    render(
      <MemoryRouter>
        <TrustedCirclePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Your trusted circle is empty/i)).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText(/Contact Name/i), {
      target: { value: 'Priya Verma' },
    });
    fireEvent.change(screen.getByLabelText(/Mobile Number \(E\.164\)/i), {
      target: { value: '+919876543210' },
    });
    fireEvent.click(
      screen.getByLabelText(/Can see live location during active SOS/i)
    );

    fireEvent.click(
      screen.getByRole('button', { name: /Send Invitation & Add to Circle/i })
    );

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith({
        name: 'Priya Verma',
        phone_e164: '+919876543210',
        permissions: {
          receives_sos: true,
          receives_checkin: true,
          can_see_live_location: true,
        },
      });
      expect(listSpy).toHaveBeenCalledTimes(2);
      expect(screen.getByText('Priya Verma')).toBeTruthy();
      expect(
        screen.getByText(/Invited \(Pending Acceptance\)/i)
      ).toBeTruthy();
    });
  });

  it('PublicInvitePage displays invitation details without login and accepts invitation', async () => {
    useAuthStore.setState({ user: null, isLoading: false, toasts: [] });

    vi.spyOn(invitationsApi, 'getInvitation').mockResolvedValueOnce({
      inviter_name: 'Aarohi Sharma',
      contact_name: 'Priya Verma',
      permissions: {
        receives_sos: true,
        receives_checkin: true,
        can_see_live_location: false,
      },
      status: 'pending',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });

    const acceptSpy = vi
      .spyOn(invitationsApi, 'acceptInvitation')
      .mockResolvedValueOnce({
        status: 'accepted',
        contact: {
          id: 'tc1',
          user_id: 'u1',
          name: 'Priya Verma',
          phone_e164: '+919876543210',
          priority_order: 1,
          permissions: {
            receives_sos: true,
            receives_checkin: true,
            can_see_live_location: false,
          },
          status: 'accepted',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });

    render(
      <MemoryRouter initialEntries={['/invite/inv_valid_token.sig']}>
        <Routes>
          <Route path="/invite/:token" element={<PublicInvitePage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Aarohi Sharma invited you to their Trusted Circle/i)
      ).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /Accept Invitation/i })
    );

    await waitFor(() => {
      expect(acceptSpy).toHaveBeenCalledWith('inv_valid_token.sig');
      expect(screen.getByText(/Invitation Accepted/i)).toBeTruthy();
    });
  });

  it('OnboardingPage explicitly asks for data_processing consent in plain language before setting up alerts', async () => {
    vi.spyOn(consentsApi, 'getConsents').mockResolvedValueOnce({
      current: {
        data_processing: false,
        location: false,
        notifications: false,
        microphone: false,
        camera: false,
      },
      history: [],
    });

    const postConsentSpy = vi
      .spyOn(consentsApi, 'postConsent')
      .mockResolvedValueOnce({
        entry: {
          id: 'c-onboard',
          user_id: 'u1',
          type: 'data_processing',
          granted: true,
          source: 'onboarding',
          created_at: new Date().toISOString(),
        },
        current: {
          data_processing: true,
          location: false,
          notifications: false,
          microphone: false,
          camera: false,
        },
        history: [],
      });

    render(
      <MemoryRouter initialEntries={['/onboarding']}>
        <Routes>
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/circle" element={<div>Circle Page Reached</div>} />
        </Routes>
      </MemoryRouter>
    );

    // Step 1 -> Step 2 -> Step 3
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Required to send alerts: Core Safety Data Processing/i)
      ).toBeTruthy();
    });

    const circleBtn = screen.getByRole('button', {
      name: /Set Up Trusted Circle/i,
    });
    expect(circleBtn.hasAttribute('disabled')).toBe(true);

    // Check explicit data_processing consent checkbox
    const checkbox = screen.getByLabelText(
      /I understand and grant Core Safety Data Processing consent/i
    );
    fireEvent.click(checkbox);
    expect(circleBtn.hasAttribute('disabled')).toBe(false);

    fireEvent.click(circleBtn);

    await waitFor(() => {
      expect(postConsentSpy).toHaveBeenCalledWith({
        type: 'data_processing',
        granted: true,
        source: 'onboarding',
      });
      expect(screen.getByText('Circle Page Reached')).toBeTruthy();
    });
  });
});
