import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { WebSocket as NodeWebSocket } from 'ws';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '../i18n';
import { HomePage } from '../pages/HomePage';
import { ConsentCenterPage } from '../pages/ConsentCenterPage';
import { SettingsPage } from '../pages/SettingsPage';
import { DiscreetTriggersManager } from '../components/DiscreetTriggersManager';
import { useAuthStore } from '../store/authStore';
import { useTriggerSettingsStore } from '../store/triggerSettingsStore';
import * as apiModule from '../lib/api';
import * as sosModule from '../lib/sos';
import {
  buildEmergencySmsBody,
  buildSmsFallbackHref,
  cancelQueuedAlert,
  clearAllOfflineStateOnLogout,
  clearAllQueuedAlerts,
  clearOfflineEmergencyContactsCache,
  computeBackoffDelayMs,
  detectSmsPlatform,
  enqueueOfflineAlert,
  flushOfflineAlertQueue,
  getCachedEmergencyContacts,
  listQueuedAlerts,
  syncOfflineEmergencyContactsCache,
} from '../lib/offlineQueue';
import { createApp } from '../../../api/server';
import { initDatabase, closeDatabase } from '../../../api/src/core/db';
import { seedDatabase } from '../../../api/src/core/seed';
import { resetRateLimiter } from '../../../api/src/core/middleware';
import { clearAllScheduledTimers } from '../../../api/src/services/scheduler';
import { attachWebSocketHub } from '../../../api/src/services/wsHub';

const mockUser: apiModule.UserProfile = {
  id: 'usr_5_1',
  phone_e164: '+919000000001',
  name: 'Aarohi Sharma',
  role: 'user',
  language: 'en',
  created_at: new Date().toISOString(),
  cancel_window_seconds: 5,
  has_cancel_pin: false,
  has_duress_pin: false,
};

describe('SAATHI Phase 5 Web Tests (Offline Queue, Idempotency, SMS Fallback, Contact Cache & Low-Connectivity)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    await clearAllQueuedAlerts();
    await clearOfflineEmergencyContactsCache();
    await i18n.changeLanguage('en');

    Object.defineProperty(window.navigator, 'onLine', {
      writable: true,
      configurable: true,
      value: true,
    });

    useAuthStore.setState({
      user: { ...mockUser },
      isLoading: false,
      darkMode: false,
      toasts: [],
    });

    useTriggerSettingsStore.getState().resetTriggerSettings();
    useTriggerSettingsStore.getState().setShortcutEnabled(true);
    sosModule.setPracticeModeTarget(null);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await clearAllQueuedAlerts();
    await clearOfflineEmergencyContactsCache();
  });

  it('1. Queue retry & exponential backoff with jitter: stores failed alerts in Dexie/IndexedDB and increments attempts & backoff delay on retry failure', async () => {
    // 1. Verify exponential backoff formula with deterministic randomFn
    const d0 = computeBackoffDelayMs(0, 1000, () => 0.4); // 1000 * 2^0 + 100 = 1100
    const d1 = computeBackoffDelayMs(1, 1000, () => 0.4); // 1000 * 2^1 + 100 = 2100
    const d2 = computeBackoffDelayMs(2, 1000, () => 0.4); // 1000 * 2^2 + 100 = 4100
    const d3 = computeBackoffDelayMs(3, 1000, () => 0.4); // 1000 * 2^3 + 100 = 8100
    expect(d0).toBe(1100);
    expect(d1).toBe(2100);
    expect(d2).toBe(4100);
    expect(d3).toBe(8100);
    expect(d2).toBeGreaterThan(d1);
    expect(d3).toBeGreaterThan(d2);

    // 2. Enqueue an offline alert in Dexie/IndexedDB
    await enqueueOfflineAlert({
      client_request_id: 'req_backoff_1',
      client_created_at: '2026-10-04T10:00:00.000Z',
      source_trigger: 'button',
      emergency_type: null,
      location: {
        lat: 28.6139,
        lng: 77.209,
        accuracy_m: 12,
        captured_at: '2026-10-04T10:00:00.000Z',
      },
    });

    const initialList = await listQueuedAlerts();
    expect(initialList).toHaveLength(1);
    expect(initialList[0].attempts).toBe(0);
    expect(initialList[0].status).toBe('queued');

    // 3. Flush while network still fails -> increments attempts, sets status='retrying', schedules future next_retry_at
    const failingFetch = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch'));
    const beforeFlush = Date.now();
    const res1 = await flushOfflineAlertQueue(
      failingFetch as unknown as typeof fetch,
      { baseBackoffMs: 500 }
    );

    expect(res1.delivered).toHaveLength(0);
    expect(res1.remaining).toHaveLength(1);
    expect(res1.remaining[0].attempts).toBe(1);
    expect(res1.remaining[0].status).toBe('retrying');
    expect(res1.remaining[0].next_retry_at).toBeGreaterThanOrEqual(
      beforeFlush + 1000
    );
  });

  it('2. Idempotency: reusing client_request_id across two retries creates only ONE incident on the real backend', async () => {
    const tempDbPath = path.join(
      os.tmpdir(),
      `saathi-phase5-idem-${crypto.randomUUID()}.db`
    );
    const db = await initDatabase(`file:${tempDbPath}`);
    await seedDatabase(db);
    resetRateLimiter();

    const app = createApp();
    const server = http.createServer(app);
    const wss = attachWebSocketHub(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const agent = request.agent(baseUrl);
      agent.set('Origin', baseUrl);
      const otpReq = await agent
        .post('/api/auth/otp/request')
        .send({ phone_e164: '+919000000001' });
      await agent.post('/api/auth/otp/verify').send({
        phone_e164: '+919000000001',
        code: otpReq.body.dev_mock_hint,
      });

      const realFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = typeof input === 'string' ? input : input.toString();
        const method = (init?.method || 'GET').toLowerCase() as
          | 'get'
          | 'post'
          | 'put'
          | 'patch'
          | 'delete';
        let req = (agent as any)[method](urlStr);
        if (init?.body && typeof init.body === 'string') {
          req = req
            .set('Content-Type', 'application/json')
            .send(JSON.parse(init.body));
        }
        const res = await req;
        return {
          ok: res.status >= 200 && res.status < 300,
          status: res.status,
          json: async () => res.body,
        } as Response;
      }) as typeof fetch;

      const sharedClientRequestId = 'req_idem_phase5_001';
      const createdAt = new Date().toISOString();

      // Retry #1 via offline queue flush
      await enqueueOfflineAlert({
        client_request_id: sharedClientRequestId,
        client_created_at: createdAt,
        source_trigger: 'button',
        emergency_type: null,
        location: {
          lat: 28.6139,
          lng: 77.209,
          accuracy_m: 10,
          captured_at: createdAt,
        },
      });
      const flush1 = await flushOfflineAlertQueue(realFetch);
      expect(flush1.delivered).toHaveLength(1);
      expect(flush1.delivered[0].idempotent_replay).toBe(false);
      const createdIncidentId = flush1.delivered[0].incident.id;

      // Retry #2 with the exact same client_request_id (simulating duplicate network retry)
      await enqueueOfflineAlert({
        client_request_id: sharedClientRequestId,
        client_created_at: createdAt,
        source_trigger: 'button',
        emergency_type: null,
        location: null,
      });
      const flush2 = await flushOfflineAlertQueue(realFetch);
      expect(flush2.delivered).toHaveLength(1);
      expect(flush2.delivered[0].idempotent_replay).toBe(true);
      expect(flush2.delivered[0].incident.id).toBe(createdIncidentId);
    } finally {
      clearAllScheduledTimers();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeDatabase();
      for (const suffix of ['', '-wal', '-shm', '-journal']) {
        const candidate = `${tempDbPath}${suffix}`;
        if (fs.existsSync(candidate)) {
          fs.unlinkSync(candidate);
        }
      }
    }
  });

  it('3. Cancel while queued: cancelling during the cancel window while offline removes the alert from the queue so it is never sent on reconnect', async () => {
    vi.spyOn(apiModule.incidentsApi, 'getActiveIncident').mockResolvedValue({
      incident: null,
      notifiable_contacts_count: 1,
    });
    vi.spyOn(apiModule.contactsApi, 'listContacts').mockResolvedValue({
      contacts: [],
      notifiable_contacts_count: 1,
    });
    vi.spyOn(apiModule.consentsApi, 'getConsents').mockResolvedValue({
      current: {
        location: false,
        notifications: true,
        microphone: false,
        camera: false,
        data_processing: true,
      },
      history: [],
    });

    const createIncidentSpy = vi.spyOn(
      apiModule.incidentsApi,
      'createIncident'
    );

    render(
      <MemoryRouter initialEntries={['/home']}>
        <DiscreetTriggersManager />
        <Routes>
          <Route path="/home" element={<HomePage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('sos-hold-button')).toBeTruthy();
      expect(screen.queryByText(/Loading safety status/i)).toBeNull();
    });

    Object.defineProperty(window.navigator, 'onLine', {
      writable: true,
      configurable: true,
      value: false,
    });

    // Trigger SOS while offline via UI keyboard shortcut (Shift+Escape)
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape', shiftKey: true });
    });

    await waitFor(async () => {
      const queuedBeforeCancel = await listQueuedAlerts();
      expect(queuedBeforeCancel).toHaveLength(1);
    });

    await waitFor(() => {
      expect(screen.getByTestId('cancel-window-screen')).toBeTruthy();
      expect(screen.getByTestId('sms-fallback-panel')).toBeTruthy();
    });

    // User cancels during cancel window while still offline
    await act(async () => {
      fireEvent.click(screen.getByTestId('cancel-alert-btn'));
    });

    // Verify alert is removed from IndexedDB queue
    const queuedAfterCancel = await listQueuedAlerts();
    expect(queuedAfterCancel).toHaveLength(0);

    // Reconnect online and flush queue -> nothing is sent to server!
    Object.defineProperty(window.navigator, 'onLine', {
      writable: true,
      configurable: true,
      value: true,
    });
    const flushRes = await flushOfflineAlertQueue();
    expect(flushRes.delivered).toHaveLength(0);
    expect(createIncidentSpy).not.toHaveBeenCalled();
  });

  it('4. Auth while offline (401 refresh-and-retry): refreshes session on 401 and retries; if refresh fails, keeps alert queued with needs_reauth and never drops it silently', async () => {
    // Case A: 401 followed by successful /api/auth/refresh -> retries and delivers incident
    await enqueueOfflineAlert({
      client_request_id: 'req_401_refresh_ok',
      client_created_at: new Date().toISOString(),
      source_trigger: 'button',
      emergency_type: null,
      location: null,
    });

    let postAttempts = 0;
    const mockFetchRefreshSuccess = vi.fn(async (url: string) => {
      if (url.includes('/auth/refresh')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ refreshed: true }),
        } as Response;
      }
      if (url.includes('/incidents')) {
        postAttempts += 1;
        if (postAttempts === 1) {
          return {
            ok: false,
            status: 401,
            json: async () => ({ error: { message: 'Token expired' } }),
          } as Response;
        }
        return {
          ok: true,
          status: 201,
          json: async () => ({
            incident: {
              id: 'inc_after_refresh',
              user_id: mockUser.id,
              status: 'TRIGGERED',
              emergency_type: null,
              client_request_id: 'req_401_refresh_ok',
              created_at: new Date().toISOString(),
              activated_at: null,
              closed_at: null,
              merged_into_id: null,
              source_trigger: 'button',
              is_duress: false,
              needs_user_action: false,
              escalation_stage: 0,
              auto_expire_minutes: 60,
            },
            idempotent_replay: false,
            merged_into_existing: false,
          }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });

    const flushOk = await flushOfflineAlertQueue(
      mockFetchRefreshSuccess as unknown as typeof fetch
    );
    expect(flushOk.delivered).toHaveLength(1);
    expect(flushOk.delivered[0].incident.id).toBe('inc_after_refresh');
    expect(flushOk.remaining).toHaveLength(0);

    // Case B: 401 and /api/auth/refresh ALSO fails -> keeps alert in queue with status='needs_reauth' and never drops it
    await enqueueOfflineAlert({
      client_request_id: 'req_401_refresh_fail',
      client_created_at: new Date().toISOString(),
      source_trigger: 'button',
      emergency_type: null,
      location: null,
    });

    const mockFetchRefreshFail = vi.fn(async (url: string) => {
      if (url.includes('/auth/refresh')) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: { message: 'Refresh token expired' } }),
        } as Response;
      }
      return {
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Unauthorized' } }),
      } as Response;
    });

    const flushFail = await flushOfflineAlertQueue(
      mockFetchRefreshFail as unknown as typeof fetch
    );
    expect(flushFail.delivered).toHaveLength(0);
    expect(flushFail.needsReauth).toBe(true);
    expect(flushFail.remaining).toHaveLength(1);
    expect(flushFail.remaining[0].client_request_id).toBe(
      'req_401_refresh_fail'
    );
    expect(flushFail.remaining[0].status).toBe('needs_reauth');
  });

  it('5. SMS link builder & Contact cache: caches ONLY accepted+receives_sos contacts, encodes Android vs iOS sms: links properly, and clears cache on logout and consent revocation', async () => {
    const rawContacts: apiModule.TrustedContact[] = [
      {
        id: 'ct_1',
        name: 'Meera Nair',
        phone_e164: '+919876543210',
        relationship: 'Sister',
        priority_order: 1,
        status: 'accepted',
        permissions: {
          receives_sos: true,
          receives_checkin: true,
          can_see_live_location: true,
        },
        created_at: new Date().toISOString(),
      },
      {
        id: 'ct_2_pending',
        name: 'Pending Friend',
        phone_e164: '+919876543211',
        relationship: 'Friend',
        priority_order: 2,
        status: 'pending',
        permissions: {
          receives_sos: true,
          receives_checkin: true,
          can_see_live_location: false,
        },
        created_at: new Date().toISOString(),
      },
      {
        id: 'ct_3_no_sos',
        name: 'Checkin Only Contact',
        phone_e164: '+919876543212',
        relationship: 'Colleague',
        priority_order: 3,
        status: 'accepted',
        permissions: {
          receives_sos: false,
          receives_checkin: true,
          can_see_live_location: false,
        },
        created_at: new Date().toISOString(),
      },
      {
        id: 'ct_4',
        name: 'Kavita Rao',
        phone_e164: '+919876543213',
        relationship: 'Mother',
        priority_order: 4,
        status: 'accepted',
        permissions: {
          receives_sos: true,
          receives_checkin: false,
          can_see_live_location: true,
        },
        created_at: new Date().toISOString(),
      },
    ];

    // 1. Sync cache: only ct_1 and ct_4 (accepted + receives_sos) are cached with minimal fields
    const cached = await syncOfflineEmergencyContactsCache(rawContacts, true);
    expect(cached).toHaveLength(2);
    expect(cached.map((c) => c.id)).toEqual(['ct_1', 'ct_4']);
    expect(Object.keys(cached[0]).sort()).toEqual([
      'id',
      'name',
      'phone_e164',
      'priority_order',
    ]);

    const fromDb = await getCachedEmergencyContacts();
    expect(fromDb).toHaveLength(2);

    // 2. Build SMS body with map link and verify Android vs iOS sms: link formats
    const bodyText = buildEmergencySmsBody({
      userName: 'Aarohi Sharma',
      location: {
        lat: 28.61391,
        lng: 77.20902,
        accuracy_m: 15,
        captured_at: '2026-10-04T12:30:00.000Z',
      },
      triggeredAtIso: '2026-10-04T12:30:00.000Z',
    });
    expect(bodyText).toContain('https://maps.google.com/?q=28.61391,77.20902');

    expect(detectSmsPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe(
      'ios'
    );
    expect(detectSmsPlatform('Mozilla/5.0 (Linux; Android 14)')).toBe(
      'android'
    );

    const phones = cached.map((c) => c.phone_e164);
    const androidGroupHref = buildSmsFallbackHref(phones, bodyText, 'android');
    expect(androidGroupHref).toBe(
      `sms:+919876543210,+919876543213?body=${encodeURIComponent(bodyText)}`
    );

    const iosGroupHref = buildSmsFallbackHref(phones, bodyText, 'ios');
    expect(iosGroupHref).toBe(
      `sms://open?addresses=+919876543210,+919876543213&body=${encodeURIComponent(bodyText)}`
    );

    const iosSingleHref = buildSmsFallbackHref([phones[0]], bodyText, 'ios');
    expect(iosSingleHref).toBe(
      `sms:+919876543210&body=${encodeURIComponent(bodyText)}`
    );

    // 3. Verify contact cache is cleared on consent revocation (data_processing = false)
    await syncOfflineEmergencyContactsCache(rawContacts, false);
    expect(await getCachedEmergencyContacts()).toHaveLength(0);

    // Re-populate and verify clearAllOfflineStateOnLogout clears IndexedDB queue, contact cache, and Service Worker CacheStorage
    await syncOfflineEmergencyContactsCache(rawContacts, true);
    await enqueueOfflineAlert({
      client_request_id: 'req_logout_clear_1',
      client_created_at: new Date().toISOString(),
      source_trigger: 'button',
      emergency_type: null,
      location: null,
    });
    expect(await getCachedEmergencyContacts()).toHaveLength(2);
    expect(await listQueuedAlerts()).toHaveLength(1);

    const deletedCaches: string[] = [];
    (window as any).caches = {
      keys: vi
        .fn()
        .mockResolvedValue(['workbox-precache-v2', 'saathi-static-assets-v1']),
      delete: vi.fn(async (key: string) => {
        deletedCaches.push(key);
        return true;
      }),
    };

    await clearAllOfflineStateOnLogout();

    expect(await getCachedEmergencyContacts()).toHaveLength(0);
    expect(await listQueuedAlerts()).toHaveLength(0);
    expect(deletedCaches).toEqual([
      'workbox-precache-v2',
      'saathi-static-assets-v1',
    ]);
    delete (window as any).caches;
  });

  it('6. Full Offline-to-Online Production Flow (Real Express + SQLite + WebSocket): Load app -> go offline -> trigger SOS -> see honest queued state & SMS fallback -> go online -> confirm alert is delivered exactly once', async () => {
    const tempDbPath = path.join(
      os.tmpdir(),
      `saathi-phase5-e2e-${crypto.randomUUID()}.db`
    );
    const db = await initDatabase(`file:${tempDbPath}`);
    await seedDatabase(db);
    resetRateLimiter();

    const app = createApp();
    const server = http.createServer(app);
    const wss = attachWebSocketHub(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const originalFetch = globalThis.fetch;
    const originalWebSocket = globalThis.WebSocket;

    try {
      const agent = request.agent(baseUrl);
      agent.set('Origin', baseUrl);
      const otpReq = await agent
        .post('/api/auth/otp/request')
        .send({ phone_e164: '+919000000001' });
      const verifyRes = await agent.post('/api/auth/otp/verify').send({
        phone_e164: '+919000000001',
        code: otpReq.body.dev_mock_hint,
      });
      const setCookieHeader = verifyRes.headers['set-cookie'];
      const cookieStr = Array.isArray(setCookieHeader)
        ? setCookieHeader.map((c: string) => c.split(';')[0]).join('; ')
        : String(setCookieHeader || '').split(';')[0];

      const meRes = await agent.get('/api/me');
      useAuthStore.setState({
        user: meRes.body,
        isLoading: false,
        toasts: [],
      });

      // Enable location consent so offline GPS fix is captured when SOS triggers
      await agent.post('/api/consents').send({
        type: 'location',
        granted: true,
        source: 'consent_center',
      });

      // Create and accept an SOS trusted contact so online load caches it in IndexedDB
      const createCtRes = await agent.post('/api/contacts').send({
        name: 'Meera Nair',
        phone_e164: '+919000000011',
        permissions: {
          receives_sos: true,
          receives_checkin: true,
          can_see_live_location: true,
        },
      });
      const inviteToken = createCtRes.body.invitation_token;
      await request(baseUrl).post(`/api/invitations/${inviteToken}/accept`);

      let simulateNetworkCut = false;

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (simulateNetworkCut) {
          throw new TypeError('Failed to fetch (offline)');
        }
        const urlStr = typeof input === 'string' ? input : input.toString();
        const method = (init?.method || 'GET').toLowerCase() as
          | 'get'
          | 'post'
          | 'put'
          | 'patch'
          | 'delete';
        let req = (agent as any)[method](urlStr);
        if (init?.body && typeof init.body === 'string') {
          req = req
            .set('Content-Type', 'application/json')
            .send(JSON.parse(init.body));
        }
        const res = await req;
        return {
          ok: res.status >= 200 && res.status < 300,
          status: res.status,
          json: async () => res.body,
        } as Response;
      }) as typeof fetch;

      const openSockets: NodeWebSocket[] = [];
      globalThis.WebSocket = class AuthenticatedWs extends NodeWebSocket {
        constructor(url: string | URL) {
          const pathPart = String(url).replace(/^wss?:\/\/[^/]+/, '');
          super(`ws://127.0.0.1:${addr.port}${pathPart}`, {
            headers: { Cookie: cookieStr },
          });
          openSockets.push(this);
        }
      } as unknown as typeof WebSocket;

      // Step 1: Load app online (caches accepted SOS contacts into IndexedDB)
      render(
        <MemoryRouter initialEntries={['/home']}>
          <DiscreetTriggersManager />
          <Routes>
            <Route path="/home" element={<HomePage />} />
            <Route path="/consents" element={<ConsentCenterPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(async () => {
        expect(screen.getByTestId('sos-hold-button')).toBeTruthy();
        expect(
          screen.getByTestId('connectivity-indicator').textContent
        ).toMatch(/Online/i);
        const cachedContacts = await getCachedEmergencyContacts();
        expect(cachedContacts.length).toBeGreaterThan(0);
      });

      // Step 2: Go offline
      simulateNetworkCut = true;
      Object.defineProperty(window.navigator, 'onLine', {
        writable: true,
        configurable: true,
        value: false,
      });
      act(() => {
        window.dispatchEvent(new Event('offline'));
      });

      await waitFor(() => {
        expect(
          screen.getByTestId('connectivity-indicator').textContent
        ).toMatch(/Offline/i);
      });

      // Step 3: Mock offline GPS coordinates and trigger SOS via Shift+Escape while offline
      (window.navigator as any).geolocation = {
        getCurrentPosition: (success: (pos: any) => void) => {
          success({
            coords: {
              latitude: 28.6139,
              longitude: 77.209,
              accuracy: 14,
            },
          });
        },
      };

      await act(async () => {
        fireEvent.keyDown(window, { key: 'Escape', shiftKey: true });
      });

      await waitFor(async () => {
        const queuedNow = await listQueuedAlerts();
        expect(queuedNow).toHaveLength(1);
      });

      // Step 4: Verify honest queued status ("Saved on this phone. It will be sent when you open the app with a connection. If you can, send it by SMS now."), SMS option, and 112/181 links
      await waitFor(() => {
        expect(screen.getByTestId('sms-fallback-panel')).toBeTruthy();
        expect(
          screen.getByTestId('honest-queued-status-text').textContent
        ).toContain(
          'Saved on this phone. It will be sent when you open the app with a connection. If you can, send it by SMS now.'
        );
        expect(screen.queryByTestId('honest-sent-at-banner')).toBeNull();
      });

      const groupSmsLink = screen.getByTestId(
        'sms-fallback-group-link'
      ) as HTMLAnchorElement;
      expect(groupSmsLink.getAttribute('href')).toContain('sms:');
      expect(groupSmsLink.getAttribute('href')).toContain(
        encodeURIComponent('https://maps.google.com/?q=28.61390,77.20900')
      );
      expect(screen.getByTestId('offline-call-112-btn')).toBeTruthy();
      expect(screen.getByTestId('offline-call-181-btn')).toBeTruthy();

      // Verify Hindi wording for queuedBannerText as well
      await act(async () => {
        await i18n.changeLanguage('hi');
      });
      expect(i18n.t('offline.queuedBannerText')).toContain(
        'इस फ़ोन पर सहेजा गया। जब आप इंटरनेट कनेक्शन के साथ ऐप खोलेंगी, तब यह भेजा जाएगा। यदि संभव हो, तो इसे अभी SMS द्वारा भेजें।'
      );
      await act(async () => {
        await i18n.changeLanguage('en');
      });

      // Verify server has 0 active incidents while offline
      const serverCheckWhileOffline = await agent.get('/api/incidents/active');
      expect(serverCheckWhileOffline.body.incident).toBeNull();

      // Step 5: Go back online -> queue flushes automatically and delivers alert exactly once!
      simulateNetworkCut = false;
      Object.defineProperty(window.navigator, 'onLine', {
        writable: true,
        configurable: true,
        value: true,
      });
      await act(async () => {
        window.dispatchEvent(new Event('online'));
      });

      await waitFor(
        async () => {
          const remaining = await listQueuedAlerts();
          expect(remaining).toHaveLength(0);
          expect(
            screen.getByTestId('honest-sent-at-banner').textContent
          ).toMatch(/Alert received by SHAKTI at/i);
        },
        { timeout: 5000 }
      );

      // Verify in TRIGGERED state that "Contacts notified" badge is NOT shown yet
      expect(screen.queryByTestId('contacts-notified-badge')).toBeNull();

      // Verify Hindi wording for "Alert received by SHAKTI at HH:MM"
      await act(async () => {
        await i18n.changeLanguage('hi');
      });
      expect(
        i18n.t('offline.sentAtBannerText', { time: '10:30 AM' })
      ).toContain('शक्ति (SHAKTI) द्वारा 10:30 AM पर अलर्ट प्राप्त किया गया');
      await act(async () => {
        await i18n.changeLanguage('en');
      });

      // Confirm the alert was delivered to the server exactly once
      const serverCheckOnline = await agent.get('/api/incidents/active');
      expect(serverCheckOnline.body.incident).toBeTruthy();
      expect(serverCheckOnline.body.incident.source_trigger).toBe(
        'keyboard_shortcut'
      );
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.WebSocket = originalWebSocket;
      clearAllScheduledTimers();
      wss.close();
      await closeDatabase();
      for (const suffix of ['', '-wal', '-shm', '-journal']) {
        const candidate = `${tempDbPath}${suffix}`;
        if (fs.existsSync(candidate)) {
          fs.unlinkSync(candidate);
        }
      }
      server.close();
    }
  }, 15000);
});
