import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LoginPage } from '../pages/LoginPage';
import { useDemoStore } from '../store/demoStore';
import { useAuthStore } from '../store/authStore';
import { authApi, demoApi } from '../lib/api';
import i18n from '../i18n';

describe('Hosted-Demo Login UI (Demo Mode OTP Hint)', () => {
  beforeEach(async () => {
        cleanup();
    useAuthStore.setState({ user: null, isLoading: false, toasts: [] });
    await i18n.changeLanguage('en');
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows "Demo code: 654321" hint on OTP screen when DEMO_MODE is true and dev_mock_hint is returned', async () => {
    useDemoStore.setState({
      checked: true,
      demoMode: true,
      status: {
        demo_mode: true,
        banner: 'DEMO MODE: no real alerts are sent',
        providers: {
          sms: { name: 'MockSmsProvider', label: 'MOCK' },
          push: { name: 'MockPushProvider', label: 'MOCK' },
          gateway_112: { name: 'MockEmergencyGateway', label: 'MOCK' },
        },
      },
    });

    vi.spyOn(authApi, 'requestOtp').mockResolvedValue({
      status: 'otp_sent',
      provider: 'MockOtpProvider',
      expires_in_seconds: 300,
      dev_mock_hint: '654321',
    });

    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>
    );

    const submitBtn = screen.getByRole('button', { name: /Send Verification OTP/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      const hint = screen.queryByTestId('demo-otp-hint');
      expect(hint).toBeTruthy();
      expect(hint?.textContent).toContain('Demo code: 654321');
    });
  });

  it('never shows the demo code hint on the login screen when DEMO_MODE is off or dev_mock_hint is absent', async () => {
    useDemoStore.setState({
      checked: true,
      demoMode: false,
      status: null,
    });

    vi.spyOn(demoApi, 'getStatus').mockRejectedValue(new Error('Demo mode off (404)'));
    vi.spyOn(authApi, 'requestOtp').mockResolvedValue({
      status: 'otp_sent',
      provider: 'MockOtpProvider',
      expires_in_seconds: 300,
    });

    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>
    );

    const submitBtn = screen.getByRole('button', { name: /Send Verification OTP/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Verify & Continue/i })).toBeTruthy();
    });

    // The hint element MUST NOT render when demoMode is false or hint is absent
    expect(screen.queryByTestId('demo-otp-hint')).toBeNull();
    expect(screen.queryByText(/Demo code:/i)).toBeNull();
  });
});
