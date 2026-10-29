import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  validateRemoteServerUrl,
  checkRemoteServerHealth,
  switchServerConfiguration,
  getServerConfig,
  resolveEffectiveApiBaseUrl,
  resolveEffectiveWebSocketUrl,
} from '../lib/serverConfig';
import { resolveSosDeliveryState, type QueuedSosAlert } from '../lib/offlineQueue';

describe('Phase 6 & 9: Offline SOS Delivery States and Hybrid Server Configuration', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('validateRemoteServerUrl (HTTPS enforcement and URL sanitization)', () => {
    it('accepts valid HTTPS remote URLs and strips trailing slashes', () => {
      const res = validateRemoteServerUrl('https://shakti.duckdns.org/');
      expect(res).toEqual({
        valid: true,
        normalizedOrigin: 'https://shakti.duckdns.org',
        apiBaseUrl: 'https://shakti.duckdns.org/api',
        error: null,
      });

      const nipRes = validateRemoteServerUrl('https://140.238.10.20.nip.io/api/');
      expect(nipRes).toEqual({
        valid: true,
        normalizedOrigin: 'https://140.238.10.20.nip.io',
        apiBaseUrl: 'https://140.238.10.20.nip.io/api',
        error: null,
      });
    });

    it('rejects plain HTTP on non-localhost remote addresses to protect Geolocation & Secure cookies', () => {
      const res = validateRemoteServerUrl('http://140.238.10.20:3000');
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/HTTPS is required/i);
    });

    it('allows http://localhost and http://127.0.0.1 for local development', () => {
      expect(validateRemoteServerUrl('http://localhost:3000')).toEqual({
        valid: true,
        normalizedOrigin: 'http://localhost:3000',
        apiBaseUrl: 'http://localhost:3000/api',
        error: null,
      });
      expect(validateRemoteServerUrl('http://127.0.0.1:3000/')).toEqual({
        valid: true,
        normalizedOrigin: 'http://127.0.0.1:3000',
        apiBaseUrl: 'http://127.0.0.1:3000/api',
        error: null,
      });
    });

    it('rejects non-HTTP schemes and embedded credentials', () => {
      expect(validateRemoteServerUrl('javascript:alert(1)').valid).toBe(false);
      expect(validateRemoteServerUrl('https://admin:pass@shakti.duckdns.org').valid).toBe(false);
    });
  });

  describe('checkRemoteServerHealth (5s timeout and /health verification)', () => {
    it('returns reachable: true when remote /api/health responds 200 with status ok', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok', service: 'saathi-api' }),
      });

      const res = await checkRemoteServerHealth(
        'https://shakti.duckdns.org',
        mockFetch as unknown as typeof fetch,
        5000
      );
      expect(res.reachable).toBe(true);
      expect(res.service).toBe('saathi-api');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://shakti.duckdns.org/api/health',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('returns reachable: false when remote server returns HTTP 502', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
      });

      const res = await checkRemoteServerHealth(
        'https://shakti.duckdns.org',
        mockFetch as unknown as typeof fetch,
        5000
      );
      expect(res.reachable).toBe(false);
      expect(res.error).toMatch(/HTTP 502/);
    });
  });

  describe('switchServerConfiguration (Pending Offline Queue Protection)', () => {
    it('refuses to switch servers when pendingQueueCount > 0 unless explicitly confirmed', () => {
      const blocked = switchServerConfiguration({
        mode: 'remote',
        remoteServerUrl: 'https://shakti.duckdns.org',
        pendingQueueCount: 2,
        allowDiscardPendingQueue: false,
      });

      expect(blocked.switched).toBe(false);
      expect(blocked.requiresQueueConfirmation).toBe(true);
      expect(blocked.error).toMatch(/pending queued SOS alerts/i);

      const confirmed = switchServerConfiguration({
        mode: 'remote',
        remoteServerUrl: 'https://shakti.duckdns.org',
        pendingQueueCount: 2,
        allowDiscardPendingQueue: true,
      });

      expect(confirmed.switched).toBe(true);
      expect(getServerConfig().mode).toBe('remote');
      expect(resolveEffectiveApiBaseUrl()).toBe('https://shakti.duckdns.org/api');
      expect(resolveEffectiveWebSocketUrl('/ws')).toBe('wss://shakti.duckdns.org/ws');
    });

    it('falls back to relative /api in standalone mode', () => {
      switchServerConfiguration({
        mode: 'standalone',
        remoteServerUrl: null,
        pendingQueueCount: 0,
      });
      expect(getServerConfig().mode).toBe('standalone');
      expect(resolveEffectiveApiBaseUrl()).toBe('/api');
    });
  });

  describe('resolveSosDeliveryState (5-stage offline vs server vs contact confirmation distinction)', () => {
    const baseQueuedAlert: QueuedSosAlert = {
      client_request_id: 'req_1',
      client_created_at: new Date().toISOString(),
      source_trigger: 'HOLD_BUTTON',
      emergency_type: 'general',
      location: {
        lat: 28.6139,
        lng: 77.209,
        accuracy_m: 12,
        captured_at: new Date().toISOString(),
      },
      attempts: 0,
      next_retry_at: Date.now(),
      status: 'queued',
      last_error: null,
    };

    it('distinguishes saved_locally, pending, submitted, server_acknowledged, and contact_notification_confirmed', () => {
      expect(
        resolveSosDeliveryState({
          incident: null,
          queuedAlert: baseQueuedAlert,
        })
      ).toBe('saved_locally');

      expect(
        resolveSosDeliveryState({
          incident: null,
          queuedAlert: { ...baseQueuedAlert, attempts: 1, status: 'retrying' },
        })
      ).toBe('pending');

      expect(
        resolveSosDeliveryState({
          incident: null,
          queuedAlert: baseQueuedAlert,
          isSubmitting: true,
        })
      ).toBe('submitted');

      expect(
        resolveSosDeliveryState({
          incident: { id: 'inc_123', status: 'ACTIVE', notifications: [] },
          queuedAlert: null,
        })
      ).toBe('server_acknowledged');

      expect(
        resolveSosDeliveryState({
          incident: {
            id: 'inc_123',
            status: 'NOTIFIED',
            notifications: [{ status: 'sent' }],
          },
          queuedAlert: null,
        })
      ).toBe('contact_notification_confirmed');
    });
  });
});
