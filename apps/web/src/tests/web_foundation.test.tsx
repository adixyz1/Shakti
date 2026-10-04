import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { apiRequest } from '../lib/api';
import { LanguageToggle } from '../components/LanguageToggle';
import { useAuthStore } from '../store/authStore';
import i18n from '../i18n';

describe('SAATHI Phase 1 Web Unit Tests (API Client & i18n Language Toggle)', () => {
  beforeEach(async () => {
    useAuthStore.setState({ user: null, isLoading: false, toasts: [] });
    await i18n.changeLanguage('en');
  });

  it('apiRequest automatically refreshes access token on 401 and retries original request', async () => {
    const mockFetch = vi.fn();

    // 1st call: /me returns 401 Unauthorized
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'Token expired' }),
    });

    // 2nd call: /auth/refresh returns 200 OK
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: 'u1', role: 'user' }),
    });

    // 3rd call: retried /me returns 200 OK with user profile
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'u1',
        phone_e164: '+919000000001',
        name: 'Aarohi Sharma',
        role: 'user',
        language: 'en',
      }),
    });

    const result = await apiRequest<{ name: string }>(
      '/me',
      { method: 'GET' },
      mockFetch as unknown as typeof fetch
    );

    expect(result.name).toBe('Aarohi Sharma');
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch.mock.calls[0][0]).toContain('/me');
    expect(mockFetch.mock.calls[1][0]).toContain('/auth/refresh');
    expect(mockFetch.mock.calls[2][0]).toContain('/me');
  });

  it('LanguageToggle switches between English (en) and Hindi (hi) and persists choice', async () => {
    render(<LanguageToggle />);

    const enBtn = screen.getByRole('button', { name: /English/i });
    const hiBtn = screen.getByRole('button', { name: /हिन्दी/i });

    expect(enBtn.getAttribute('aria-pressed')).toBe('true');
    expect(hiBtn.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(hiBtn);

    await waitFor(() => {
      expect(i18n.language).toBe('hi');
      expect(hiBtn.getAttribute('aria-pressed')).toBe('true');
      expect(window.localStorage.getItem('saathi_lang')).toBe('hi');
    });
  });
});
