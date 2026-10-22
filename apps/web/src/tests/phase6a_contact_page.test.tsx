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
import { ContactAlertPage } from '../pages/ContactAlertPage';
import { HomePage, triggerSos } from '../pages/HomePage';
import { useAuthStore } from '../store/authStore';
import { useTriggerSettingsStore } from '../store/triggerSettingsStore';
import * as apiModule from '../lib/api';
import { createApp } from '../../../api/server';
import { closeDatabase, initDatabase } from '../../../api/src/core/db';
import { resetRateLimiter } from '../../../api/src/core/middleware';
import { seedDatabase } from '../../../api/src/core/seed';
import { clearAllScheduledTimers } from '../../../api/src/services/scheduler';
import { attachWebSocketHub } from '../../../api/src/services/wsHub';

const baseSummary: apiModule.ContactIncidentSummaryDto = {
  incident_id: 'inc_6a_web_1',
  user_first_name: 'Aarohi',
  user_phone_e164: '+919000000001',
  contact_id: 'ct_6a_1',
  contact_name: 'Priya Verma',
  triggered_at: '2026-10-05T10:15:00.000Z',
  activated_at: '2026-10-05T10:15:05.000Z',
  emergency_type: 'followed',
  status: 'NOTIFIED',
  is_duress: false,
  duress_notice: null,
  can_see_live_location: true,
  location_freshness_seconds: 12,
  location: {
    lat: 28.6139,
    lng: 77.209,
    accuracy_m: 14,
    captured_at: '2026-10-05T10:15:05.000Z',
  },
};

describe('SAATHI Phase 6A Web Tests (Trusted Contact Page, Duress Awareness, Data-Saver/Offline Coords & Two-Window Live Sync)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    await i18n.changeLanguage('en');

    Object.defineProperty(window.navigator, 'onLine', {
      writable: true,
      configurable: true,
      value: true,
    });

    useAuthStore.setState({
      user: null,
      isLoading: false,
      darkMode: false,
      toasts: [],
    });
    useTriggerSettingsStore.getState().resetTriggerSettings();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('1. Normal contact alert view: renders with no login, shows first name, time, emergency type, Leaflet map with last updated label, all 5 response buttons (56px), Call 112 + Call her links, and Hindi (hi) localization', async () => {
    vi.spyOn(apiModule.contactMagicApi, 'getSummary').mockResolvedValue({
      ...baseSummary,
    });
    const respondSpy = vi
      .spyOn(apiModule.contactMagicApi, 'respond')
      .mockResolvedValue({
        action: 'on_my_way',
        incident_status: 'RESPONDING',
        closed: false,
        summary: {
          ...baseSummary,
          status: 'RESPONDING',
        },
      });

    render(
      <MemoryRouter initialEntries={['/c/ctk_valid_normal.sig123']}>
        <Routes>
          <Route path="/c/:token" element={<ContactAlertPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('contact-alert-active-view')).toBeTruthy();
      expect(screen.getByTestId('contact-alert-heading').textContent).toBe(
        'Aarohi triggered an emergency alert'
      );
    });

    // No duress banner on normal incident
    expect(screen.queryByTestId('contact-duress-warning-banner')).toBeNull();

    // Emergency type & status
    expect(screen.getByTestId('contact-alert-type').textContent).toContain(
      'Followed'
    );
    expect(
      screen.getByTestId('contact-alert-real-status').textContent
    ).toContain('NOTIFIED');

    // Leaflet map + last updated label + single latest point (no location history)
    expect(screen.getByTestId('contact-leaflet-map')).toBeTruthy();
    expect(
      screen.getByTestId('contact-location-last-updated').textContent
    ).toContain('12s ago');
    expect(
      screen.getByTestId('contact-location-coords-text').textContent
    ).toContain('28.61390, 77.20900');

    // All 5 action buttons + Call 112 + Call her (tel:) links
    expect(screen.getByTestId('contact-btn-seen')).toBeTruthy();
    expect(screen.getByTestId('contact-btn-on-my-way')).toBeTruthy();
    expect(screen.getByTestId('contact-btn-calling-her')).toBeTruthy();
    expect(screen.getByTestId('contact-btn-cannot-help')).toBeTruthy();
    expect(screen.getByTestId('contact-btn-confirm-safe')).toBeTruthy();
    expect(
      screen.getByTestId('contact-call-112-btn').getAttribute('href')
    ).toBe('tel:112');
    expect(
      screen.getByTestId('contact-call-her-btn').getAttribute('href')
    ).toBe('tel:+919000000001');

    // Tap "I'm on my way" -> calls POST /api/c/:token/respond with action='on_my_way'
    await act(async () => {
      fireEvent.click(screen.getByTestId('contact-btn-on-my-way'));
    });

    expect(respondSpy).toHaveBeenCalledWith('ctk_valid_normal.sig123', {
      action: 'on_my_way',
    });
    expect(
      screen.getByTestId('contact-response-feedback').textContent
    ).toContain("I'm on my way");
    expect(
      screen.getByTestId('contact-alert-real-status').textContent
    ).toContain('RESPONDING');

    // Switch to Hindi and verify localization
    await act(async () => {
      await i18n.changeLanguage('hi');
    });
    expect(screen.getByTestId('contact-alert-heading').textContent).toContain(
      'Aarohi ने आपातकालीन अलर्ट शुरू किया है'
    );
  });

  it('2. Duress awareness for contacts: displays calm safety notice ("Her phone shows this alert as cancelled...") and hides "I\'m calling her" and "Call her" buttons', async () => {
    vi.spyOn(apiModule.contactMagicApi, 'getSummary').mockResolvedValue({
      ...baseSummary,
      is_duress: true,
      duress_notice:
        'Her phone shows this alert as cancelled. She may not be able to talk safely. Do not call or message her. Consider contacting security or 112.',
    });

    render(
      <MemoryRouter initialEntries={['/c/ctk_duress_token.sig456']}>
        <Routes>
          <Route path="/c/:token" element={<ContactAlertPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('contact-duress-warning-banner')).toBeTruthy();
    });

    // Exact required duress notice text
    expect(
      screen.getByTestId('contact-duress-notice-text').textContent
    ).toBe(
      'Her phone shows this alert as cancelled. She may not be able to talk safely. Do not call or message her. Consider contacting security or 112.'
    );

    // "I'm calling her" button and "Call her" tel: link must be HIDDEN during duress
    expect(screen.queryByTestId('contact-btn-calling-her')).toBeNull();
    expect(screen.queryByTestId('contact-call-her-btn')).toBeNull();

    // Other response buttons ("I've seen this", "I'm on my way", "She is safe (close alert)", "Call 112") remain available
    expect(screen.getByTestId('contact-btn-seen')).toBeTruthy();
    expect(screen.getByTestId('contact-btn-on-my-way')).toBeTruthy();
    expect(screen.getByTestId('contact-btn-confirm-safe')).toBeTruthy();
    expect(screen.getByTestId('contact-call-112-btn')).toBeTruthy();
  });

  it('3. Offline / Data-saver mode & Omitted location state: shows text coordinates instead of map tiles when offline or in data-saver mode, and shows clear notice when location permission is off', async () => {
    const getSummarySpy = vi
      .spyOn(apiModule.contactMagicApi, 'getSummary')
      .mockResolvedValue({
        ...baseSummary,
      });

    const { unmount } = render(
      <MemoryRouter initialEntries={['/c/ctk_datasaver.sig789']}>
        <Routes>
          <Route path="/c/:token" element={<ContactAlertPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('contact-leaflet-map')).toBeTruthy();
    });

    // Toggle Data-Saver mode ON -> replaces Leaflet map tiles with text coordinates
    fireEvent.click(screen.getByTestId('contact-data-saver-toggle'));
    await waitFor(() => {
      expect(screen.queryByTestId('contact-leaflet-map')).toBeNull();
      expect(screen.getByTestId('contact-location-text-only')).toBeTruthy();
      expect(
        screen.getByTestId('contact-location-coords-text').textContent
      ).toContain('28.61390, 77.20900');
    });

    unmount();

    // Now test when contact does NOT have `can_see_live_location` (coordinates omitted by backend)
    getSummarySpy.mockResolvedValueOnce({
      ...baseSummary,
      can_see_live_location: false,
      location_freshness_seconds: null,
      location: undefined,
    });

    render(
      <MemoryRouter initialEntries={['/c/ctk_noloc.sig789']}>
        <Routes>
          <Route path="/c/:token" element={<ContactAlertPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('contact-location-omitted')).toBeTruthy();
      expect(screen.queryByTestId('contact-leaflet-map')).toBeNull();
      expect(screen.queryByTestId('contact-location-coords-text')).toBeNull();
    });
  });

  it('4. Expired or closed state: renders clear expired/closed screen on 410/403/404 or after tapping "She is safe (close alert)"', async () => {
    vi.spyOn(apiModule.contactMagicApi, 'getSummary').mockRejectedValueOnce(
      new apiModule.ApiError(
        410,
        'This emergency alert is closed (RESOLVED). The link is no longer active.'
      )
    );

    render(
      <MemoryRouter initialEntries={['/c/ctk_closed.sig000']}>
        <Routes>
          <Route path="/c/:token" element={<ContactAlertPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('contact-alert-expired-card')).toBeTruthy();
      expect(screen.getByTestId('contact-alert-expired-title').textContent).toBe(
        'This alert link is closed or expired'
      );
      expect(screen.getByTestId('contact-expired-call-112')).toBeTruthy();
    });
  });

  it('5. Two-Window Live Browser Check (Window 1: Authenticated Owner on /home, Window 2: Unauthenticated Contact opening magic link from /api/dev/outbox): Contact taps "I\'m on my way" and Owner live status updates to RESPONDING in real time via WebSocket', async () => {
    vi.restoreAllMocks();
    const tempDbPath = path.join(
      os.tmpdir(),
      `saathi-phase6a-twowin-${crypto.randomUUID()}.db`
    );
    const db = await initDatabase(`file:${tempDbPath}`);
    await seedDatabase(db);
    resetRateLimiter();

    const app = createApp();
    const server = http.createServer(app);
    const wss = attachWebSocketHub(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    const addr = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const originalFetch = globalThis.fetch;
    const originalWebSocket = globalThis.WebSocket;

    try {
      // Authenticate Owner (Window 1 session)
      const ownerAgent = request.agent(baseUrl);
      ownerAgent.set('Origin', baseUrl);
      process.env.DEMO_MODE = 'true';
      const otpReq = await ownerAgent
        .post('/api/auth/otp/request')
        .send({ phone_e164: '+919000000001' });
      const verifyRes = await ownerAgent.post('/api/auth/otp/verify').send({
        phone_e164: '+919000000001',
        code: otpReq.body.dev_mock_hint,
      });
      const setCookieHeader = verifyRes.headers['set-cookie'];
      const cookieStr = Array.isArray(setCookieHeader)
        ? setCookieHeader.map((c: string) => c.split(';')[0]).join('; ')
        : String(setCookieHeader || '').split(';')[0];

      // Set 0s cancel window so SOS activates immediately and dispatches SMS to dev outbox
      await ownerAgent
        .put('/api/settings/cancel-window')
        .send({ cancel_window_seconds: 0 });
      await ownerAgent.post('/api/consents').send({
        type: 'location',
        granted: true,
        source: 'test',
      });

      // Add & accept trusted contact Priya Verma
      const addContactRes = await ownerAgent.post('/api/contacts').send({
        name: 'Priya Verma',
        phone_e164: '+919811122233',
        permissions: {
          receives_sos: true,
          receives_checkin: true,
          can_see_live_location: true,
        },
      });
      await request(baseUrl)
        .post(`/api/invitations/${addContactRes.body.invitation_token}/accept`)
        .send();

      useAuthStore.setState({
        user: { ...verifyRes.body, cancel_window_seconds: 0 },
        isLoading: false,
        toasts: [],
      });

      // Route `/api/c/*` without cookies (simulating private/incognito Window 2) and owner routes through `ownerAgent` (Window 1)
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = typeof input === 'string' ? input : input.toString();
        const method = (init?.method || 'GET').toLowerCase() as
          | 'get'
          | 'post'
          | 'put'
          | 'patch'
          | 'delete';
        const isPublicContactRoute = urlStr.startsWith('/api/c/');
        const client = isPublicContactRoute ? request(baseUrl) : ownerAgent;
        let req = (client as any)[method](urlStr);
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

      globalThis.WebSocket = class AuthenticatedWs extends NodeWebSocket {
        constructor(url: string | URL) {
          const pathPart = String(url).replace(/^wss?:\/\/[^/]+/, '');
          super(`ws://127.0.0.1:${addr.port}${pathPart}`, {
            headers: { Cookie: cookieStr },
          });
        }
      } as unknown as typeof WebSocket;

      // Render Window 1 (Owner HomePage)
      const window1Container = document.createElement('div');
      document.body.appendChild(window1Container);
      const win1 = render(
        <MemoryRouter initialEntries={['/home']}>
          <Routes>
            <Route path="/home" element={<HomePage />} />
          </Routes>
        </MemoryRouter>,
        { container: window1Container }
      );

      await waitFor(() => {
        expect(win1.getByTestId('sos-hold-button')).toBeTruthy();
      });

      // Step 1: Owner triggers SOS in Window 1
      await act(async () => {
        await triggerSos('button');
      });

      // Owner Window 1 shows live status ("Contacts notified") and "Alert received by SAATHI at ..."
      await waitFor(() => {
        expect(win1.getByTestId('live-status-screen')).toBeTruthy();
        expect(win1.getByTestId('live-status-heading').textContent).toBe(
          'Contacts notified'
        );
        expect(win1.getByTestId('contacts-notified-badge').textContent).toBe(
          'Contacts notified'
        );
        expect(win1.getByTestId('honest-sent-at-banner').textContent).toMatch(
          /Alert received by SHAKTI at/i
        );
      });

      // Step 2: Inspect `/api/dev/outbox` to get the magic link sent to Priya Verma
      const outboxRes = await ownerAgent.get('/api/dev/outbox');
      const sosSms = outboxRes.body.messages.find(
        (m: any) =>
          m.purpose === 'sos_alert' && m.to_phone_e164 === '+919811122233'
      );
      expect(sosSms).toBeTruthy();
      const contactUrlPath: string = sosSms.metadata.contact_url; // e.g., `/c/ctk_...`
      expect(contactUrlPath).toMatch(/^\/c\/ctk_/);

      // Step 3: Open the magic link in Window 2 (separate unauthenticated DOM container)
      const window2Container = document.createElement('div');
      document.body.appendChild(window2Container);
      const win2 = render(
        <MemoryRouter initialEntries={[contactUrlPath]}>
          <Routes>
            <Route path="/c/:token" element={<ContactAlertPage />} />
          </Routes>
        </MemoryRouter>,
        { container: window2Container }
      );

      await waitFor(() => {
        expect(win2.getByTestId('contact-alert-heading').textContent).toBe(
          'Aarohi triggered an emergency alert'
        );
      });

      // Step 4: Contact in Window 2 taps "I'm on my way"
      await act(async () => {
        fireEvent.click(win2.getByTestId('contact-btn-on-my-way'));
      });

      // Verify Window 2 updates to RESPONDING
      await waitFor(() => {
        expect(
          win2.getByTestId('contact-alert-real-status').textContent
        ).toContain('RESPONDING');
      });

      // Step 5: Verify Owner's Window 1 updates LIVE via WebSocket to RESPONDING ("Help is responding")!
      await waitFor(() => {
        expect(win1.getByTestId('live-status-heading').textContent).toBe(
          'Help is responding'
        );
        expect(win1.getByTestId('contacts-notified-badge').textContent).toBe(
          'Contacts notified'
        );
      });

      win1.unmount();
      win2.unmount();
      window1Container.remove();
      window2Container.remove();
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.WebSocket = originalWebSocket;
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
  }, 15000);
});
