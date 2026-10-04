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
import { MemoryRouter } from 'react-router-dom';
import { createApp } from '../../../api/server';
import { config } from '../../../api/src/core/config';
import { closeDatabase, initDatabase } from '../../../api/src/core/db';
import { resetRateLimiter } from '../../../api/src/core/middleware';
import { seedDatabase } from '../../../api/src/core/seed';
import {
  clearAllScheduledTimers,
  recoverPendingIncidentsOnStartup,
  scheduleEscalationLadder,
} from '../../../api/src/services/scheduler';
import { incidents } from '../../../api/src/db/schema';
import { eq } from 'drizzle-orm';
import { attachWebSocketHub } from '../../../api/src/services/wsHub';
import { HomePage, triggerSos } from '../pages/HomePage';
import {
  ApiError,
  consentsApi,
  contactsApi,
  incidentsApi,
  type IncidentDto,
} from '../lib/api';
import { useAuthStore } from '../store/authStore';
import i18n from '../i18n';

function makeIncident(overrides: Partial<IncidentDto> = {}): IncidentDto {
  return {
    id: 'inc_4a_1',
    user_id: 'u_demo_1',
    status: 'TRIGGERED',
    emergency_type: null,
    client_request_id: 'req_4a_1',
    created_at: new Date().toISOString(),
    activated_at: null,
    closed_at: null,
    merged_into_id: null,
    source_trigger: 'button',
    is_duress: false,
    needs_user_action: false,
    escalation_stage: 0,
    notifiable_contacts_count: 1,
    events: [],
    locations: [],
    notifications: [],
    ...overrides,
  };
}

describe('SAATHI Phase 4A Web Tests (SOS Core Experience)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');

    useAuthStore.setState({
      user: {
        id: 'u_demo_1',
        phone_e164: '+919000000001',
        name: 'Aarohi Sharma',
        role: 'user',
        language: 'en',
        created_at: '2026-10-04T00:00:00.000Z',
        cancel_window_seconds: 5,
      },
      isLoading: false,
      toasts: [],
    });

    vi.spyOn(consentsApi, 'getConsents').mockResolvedValue({
      current: {
        data_processing: true,
        location: false,
        notifications: false,
        microphone: false,
        camera: false,
      },
      history: [],
    });

    vi.spyOn(contactsApi, 'listContacts').mockResolvedValue({
      contacts: [
        {
          id: 'c_1',
          user_id: 'u_demo_1',
          name: 'Priya Verma',
          phone_e164: '+919876543210',
          priority_order: 1,
          permissions: {
            receives_sos: true,
            receives_checkin: true,
            can_see_live_location: true,
          },
          status: 'accepted',
          created_at: '2026-10-04T00:00:00.000Z',
          updated_at: '2026-10-04T00:00:00.000Z',
        },
      ],
      notifiable_contacts_count: 1,
    });

    vi.spyOn(incidentsApi, 'getActiveIncident').mockResolvedValue({
      incident: null,
      notifiable_contacts_count: 1,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('1. Zero-contacts warning banner: displays warning when notifiable_contacts_count is 0 without blocking the SOS button', async () => {
    vi.spyOn(incidentsApi, 'getActiveIncident').mockResolvedValueOnce({
      incident: null,
      notifiable_contacts_count: 0,
    });
    vi.spyOn(contactsApi, 'listContacts').mockResolvedValueOnce({
      contacts: [],
      notifiable_contacts_count: 0,
    });

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('zero-contacts-banner')).toBeTruthy();
      expect(
        screen.getByText(/No one will be alerted yet\. Add a trusted contact\./i)
      ).toBeTruthy();
    });

    // SOS button must remain enabled and never blocked
    const sosButton = screen.getByTestId('sos-hold-button');
    expect((sosButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('2. Hold-to-trigger timing & early release: releasing before 2 seconds does nothing; holding full 2 seconds triggers SOS via triggerSos(source)', async () => {
    const createSpy = vi
      .spyOn(incidentsApi, 'createIncident')
      .mockResolvedValue({
        incident: makeIncident({ status: 'TRIGGERED' }),
        idempotent_replay: false,
        merged_into_existing: false,
        notifiable_contacts_count: 1,
      });

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('sos-hold-button')).toBeTruthy();
    });

    vi.useFakeTimers();
    const sosButton = screen.getByTestId('sos-hold-button');

    // Start holding, then release early at 1.0s (1000ms < 2000ms)
    fireEvent.mouseDown(sosButton);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent.mouseUp(sosButton);

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(createSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('sos-sr-announcer').textContent).toMatch(
      /SOS hold released early/i
    );

    // Now hold for the full 2.0 seconds (2000ms)
    fireEvent.mouseDown(sosButton);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    vi.useRealTimers();

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(createSpy.mock.calls[0][0].source_trigger).toBe('button');
      expect(screen.getByTestId('cancel-window-screen')).toBeTruthy();
    });
  });

  it('3. Cancel window countdown & plain cancel (no PIN configured): counts down and cancels directly', async () => {
    vi.spyOn(incidentsApi, 'getActiveIncident').mockResolvedValueOnce({
      incident: makeIncident({ status: 'TRIGGERED' }),
      notifiable_contacts_count: 1,
    });

    const cancelSpy = vi
      .spyOn(incidentsApi, 'cancelIncident')
      .mockResolvedValue({
        status: 'CANCELLED',
        incident: makeIncident({ status: 'CANCELLED' }),
        notifiable_contacts_count: 1,
      });

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('cancel-window-screen')).toBeTruthy();
      expect(screen.getByTestId('cancel-countdown').textContent).toContain(
        'Sending alert in 5s'
      );
    });

    // Sharing preview shows who will be alerted and honest location-off notice
    expect(screen.getByText('Priya Verma')).toBeTruthy();
    expect(
      screen.getByText(/Location is off; contacts get the alert without it/i)
    ).toBeTruthy();
    expect(
      screen.getByText(/Stops automatically in 60 min/i)
    ).toBeTruthy();

    // Tap Cancel Alert directly
    fireEvent.click(screen.getByTestId('cancel-alert-btn'));

    await waitFor(() => {
      expect(cancelSpy).toHaveBeenCalledWith('inc_4a_1', {});
      expect(screen.getByTestId('closed-status-screen')).toBeTruthy();
      expect(screen.getByText(/Alert cancelled/i)).toBeTruthy();
    });
  });

  it('4. PIN keypad cancel flow: opens large numeric keypad (no system input), rejects wrong PIN calmly without revealing limits, and cancels identically on cancel/duress PIN', async () => {
    vi.spyOn(incidentsApi, 'getActiveIncident').mockResolvedValueOnce({
      incident: makeIncident({ status: 'TRIGGERED' }),
      notifiable_contacts_count: 1,
    });

    const cancelSpy = vi
      .spyOn(incidentsApi, 'cancelIncident')
      // 1st call: user taps Cancel without PIN -> server responds 400 PIN is required
      .mockRejectedValueOnce(
        new ApiError(400, 'PIN is required to cancel an alert.')
      )
      // 2nd call: user enters wrong PIN 0000 -> server responds 400 Invalid PIN.
      .mockRejectedValueOnce(new ApiError(400, 'Invalid PIN.'))
      // 3rd call: user enters valid cancel or duress PIN 9999 -> server responds 200 CANCELLED
      .mockResolvedValueOnce({
        status: 'CANCELLED',
        incident: makeIncident({ status: 'CANCELLED' }),
        notifiable_contacts_count: 1,
      });

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('cancel-alert-btn')).toBeTruthy();
    });

    // Click Cancel Alert -> server indicates PIN is required -> opens numeric keypad
    fireEvent.click(screen.getByTestId('cancel-alert-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('pin-keypad')).toBeTruthy();
    });

    // Verify no system <input> is rendered inside the PIN keypad
    const keypad = screen.getByTestId('pin-keypad');
    expect(keypad.querySelectorAll('input').length).toBe(0);

    // Enter wrong PIN "0000" using keypad buttons
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Digit 0' }));
    }
    expect(screen.getByTestId('pin-display').textContent).toBe('●●●●');

    fireEvent.click(screen.getByTestId('pin-submit-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('pin-error').textContent).toMatch(
        /Incorrect PIN\. Please try again\./i
      );
    });

    // Enter PIN "9999" (cancel or duress PIN) and submit
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Digit 9' }));
    }
    fireEvent.click(screen.getByTestId('pin-submit-btn'));

    await waitFor(() => {
      expect(cancelSpy).toHaveBeenLastCalledWith('inc_4a_1', { pin: '9999' });
      expect(screen.getByTestId('closed-status-screen')).toBeTruthy();
      expect(screen.getByText(/Alert cancelled/i)).toBeTruthy();
    });
  });

  it('5. Live status screen, needs_user_action prompt, emergency type chips, and I am safe resolution', async () => {
    vi.spyOn(incidentsApi, 'getActiveIncident').mockResolvedValueOnce({
      incident: makeIncident({
        status: 'NOTIFIED',
        needs_user_action: true,
        escalation_stage: 2,
      }),
      notifiable_contacts_count: 1,
    });

    const typeSpy = vi
      .spyOn(incidentsApi, 'setEmergencyType')
      .mockResolvedValue({
        incident: makeIncident({
          status: 'NOTIFIED',
          needs_user_action: true,
          emergency_type: 'followed',
        }),
      });

    const resolveSpy = vi
      .spyOn(incidentsApi, 'resolveIncident')
      .mockResolvedValue({
        incident: makeIncident({
          status: 'RESOLVED',
          needs_user_action: false,
        }),
      });

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('live-status-screen')).toBeTruthy();
      expect(screen.getByTestId('live-status-heading').textContent).toBe(
        'Alert sent'
      );
      expect(screen.getByTestId('needs-user-action-banner')).toBeTruthy();
      expect(screen.getByTestId('call-112-now-btn').textContent).toMatch(
        /Call 112 now/i
      );
    });

    // Tap optional "Followed" emergency type chip
    fireEvent.click(screen.getByRole('button', { name: 'Followed' }));
    await waitFor(() => {
      expect(typeSpy).toHaveBeenCalledWith('inc_4a_1', 'followed');
    });

    // Tap "I'm safe"
    fireEvent.click(screen.getByTestId('im-safe-btn'));
    await waitFor(() => {
      expect(resolveSpy).toHaveBeenCalledWith('inc_4a_1', {
        resolution: 'RESOLVED',
      });
      expect(screen.getByTestId('closed-status-screen')).toBeTruthy();
      expect(screen.getByText(/You marked yourself safe/i)).toBeTruthy();
    });
  });

  it('6. Location capture happens ONLY during an open alert when location consent is granted, and triggerSos(source) works directly', async () => {
    vi.spyOn(consentsApi, 'getConsents').mockResolvedValueOnce({
      current: {
        data_processing: true,
        location: true,
        notifications: false,
        microphone: false,
        camera: false,
      },
      history: [],
    });

    const geoMock = vi.fn((success: PositionCallback) => {
      success({
        coords: {
          latitude: 28.6139,
          longitude: 77.209,
          accuracy: 14.2,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
          toJSON: () => ({}),
        },
        timestamp: Date.now(),
        toJSON: () => ({}),
      });
    });

    Object.defineProperty(globalThis.navigator, 'geolocation', {
      value: { getCurrentPosition: geoMock },
      configurable: true,
    });

    vi.spyOn(incidentsApi, 'createIncident').mockResolvedValueOnce({
      incident: makeIncident({ status: 'ACTIVE' }),
      idempotent_replay: false,
      merged_into_existing: false,
      notifiable_contacts_count: 1,
    });

    const locSpy = vi
      .spyOn(incidentsApi, 'addLocationSample')
      .mockResolvedValue({
        location: {
          id: 'loc_1',
          incident_id: 'inc_4a_1',
          lat: 28.6139,
          lng: 77.209,
          accuracy_m: 14.2,
          captured_at: '2026-10-04T15:30:00.000Z',
          expires_at: Date.now() + 86400000,
        },
      });

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('sos-hold-button')).toBeTruthy();
    });

    // While idle, geolocation must NEVER be called
    expect(geoMock).not.toHaveBeenCalled();

    // Trigger SOS via the unified triggerSos(source) function
    await act(async () => {
      await triggerSos('button');
    });

    await waitFor(() => {
      expect(geoMock).toHaveBeenCalled();
      expect(locSpy).toHaveBeenCalledWith(
        'inc_4a_1',
        expect.objectContaining({
          lat: 28.6139,
          lng: 77.209,
          accuracy_m: 14.2,
        })
      );
      expect(screen.getByText(/Accuracy: ±14 m/i)).toBeTruthy();
    });
  });

  it('7. Honest server-unreachable state with Retry + Call 112 fallback and Hindi (hi) localization', async () => {
    vi.spyOn(incidentsApi, 'getActiveIncident').mockRejectedValueOnce(
      new Error('Network failure')
    );

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Couldn't reach the server/i)).toBeTruthy();
      expect(screen.getByRole('button', { name: /Retry/i })).toBeTruthy();
    });

    // Clicking Retry reloads overview cleanly
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));

    await waitFor(() => {
      expect(screen.queryByText(/Couldn't reach the server/i)).toBeNull();
      expect(screen.getByTestId('sos-hold-button')).toBeTruthy();
    });

    // Switch language to Hindi and verify translated SOS instructions
    await act(async () => {
      await i18n.changeLanguage('hi');
    });

    expect(
      screen.getByText(/आपातकालीन अलर्ट शुरू करने के लिए 2 सेकंड तक दबाए रखें/i)
    ).toBeTruthy();
  });

  it('8. Mobile viewport (390x844) full E2E check against real Express + SQLite + WebSocket: zero-contacts warning -> cancel inside window -> trigger -> ACTIVE -> NOTIFIED live status via WS -> I am safe', async () => {
    vi.restoreAllMocks();
    // Set mobile viewport (390x844)
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 390,
    });
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: 844,
    });

    const tempDbPath = path.join(
      os.tmpdir(),
      `saathi-phase4a-e2e-${crypto.randomUUID()}.db`
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
      // Authenticate demo user via Supertest agent
      const agent = request.agent(baseUrl);
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

      // Shorten cancel window to 1s for fast E2E verification
      await agent
        .put('/api/settings/cancel-window')
        .send({ cancel_window_seconds: 1 });

      useAuthStore.setState({
        user: { ...verifyRes.body, cancel_window_seconds: 1 },
        isLoading: false,
        toasts: [],
      });

      // Bridge window.fetch to authenticated Supertest agent
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
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

      // Bridge window.WebSocket to real ws server with auth cookie
      globalThis.WebSocket = class AuthenticatedWs extends NodeWebSocket {
        constructor(url: string | URL) {
          const pathPart = String(url).replace(/^wss?:\/\/[^/]+/, '');
          super(`ws://127.0.0.1:${addr.port}${pathPart}`, {
            headers: { Cookie: cookieStr },
          });
        }
      } as unknown as typeof WebSocket;

      render(
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      );

      // Step A: Verify zero-contacts warning is shown initially
      await waitFor(() => {
        expect(screen.getByTestId('zero-contacts-banner')).toBeTruthy();
      });

      // Step B: Trigger SOS #1 and cancel it inside the 1s cancel window
      await act(async () => {
        await triggerSos('button');
      });

      await waitFor(() => {
        expect(screen.getByTestId('cancel-window-screen')).toBeTruthy();
      });

      fireEvent.click(screen.getByTestId('cancel-alert-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('closed-status-screen')).toBeTruthy();
        expect(screen.getByText(/Alert cancelled/i)).toBeTruthy();
      });

      // Return to ready screen
      fireEvent.click(screen.getByTestId('return-home-btn'));

      // Add and accept a trusted contact so notifications fire on SOS #2
      const addContactRes = await agent.post('/api/contacts').send({
        name: 'Meera Joshi',
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

      // Step C: Trigger SOS #2 -> Cancel Window -> Wait 1.2s -> Live Status updates via WebSocket -> "I'm safe"
      await act(async () => {
        await triggerSos('button');
      });

      await waitFor(() => {
        expect(screen.getByTestId('cancel-window-screen')).toBeTruthy();
      });

      // Wait for 1s cancel window to elapse and WebSocket to push NOTIFIED state
      await waitFor(
        () => {
          expect(screen.getByTestId('live-status-screen')).toBeTruthy();
          expect(screen.getByTestId('live-status-heading').textContent).toMatch(
            /Alert sent|Help is being notified/i
          );
        },
        { timeout: 3500 }
      );

      // Tap "I'm safe" to resolve
      fireEvent.click(screen.getByTestId('im-safe-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('closed-status-screen')).toBeTruthy();
        expect(screen.getByText(/You marked yourself safe/i)).toBeTruthy();
      });
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
  });

  it('9. Auto-expiry (EXPIRED): UI reads real auto_expire_minutes from server, backend transitions open incident to EXPIRED after timeout, rejects further location samples, notifies owner via WS, and preserves duress masking', async () => {
    vi.restoreAllMocks();
    const originalAutoExpire = config.incidentAutoExpireMinutes;
    config.incidentAutoExpireMinutes = 45; // Non-60 value to prove UI reads from server

    const tempDbPath = path.join(
      os.tmpdir(),
      `saathi-phase4a-expire-${crypto.randomUUID()}.db`
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

      // Responder login to inspect unmasked duress state
      const responderAgent = request.agent(baseUrl);
      const respOtp = await responderAgent
        .post('/api/auth/otp/request')
        .send({ phone_e164: '+919000000002' });
      await responderAgent.post('/api/auth/otp/verify').send({
        phone_e164: '+919000000002',
        code: respOtp.body.dev_mock_hint,
      });

      await agent
        .put('/api/settings/cancel-window')
        .send({ cancel_window_seconds: 0 });

      useAuthStore.setState({
        user: { ...verifyRes.body, cancel_window_seconds: 0 },
        isLoading: false,
        toasts: [],
      });

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
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

      globalThis.WebSocket = class AuthenticatedWs extends NodeWebSocket {
        constructor(url: string | URL) {
          const pathPart = String(url).replace(/^wss?:\/\/[^/]+/, '');
          super(`ws://127.0.0.1:${addr.port}${pathPart}`, {
            headers: { Cookie: cookieStr },
          });
        }
      } as unknown as typeof WebSocket;

      render(
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('sos-hold-button')).toBeTruthy();
      });

      // Trigger SOS #1 (normal incident)
      let incId = '';
      await act(async () => {
        const created = await triggerSos('button');
        incId = created.incident.id;
        expect(created.incident.auto_expire_minutes).toBe(45);
      });

      // Verify UI displays server's 45 min duration (not hardcoded 60)
      await waitFor(() => {
        expect(screen.getByTestId('sharing-auto-stop').textContent).toContain(
          '45 min'
        );
      });

      // Schedule short auto-expiry (150ms) and verify transition to EXPIRED + WebSocket update
      scheduleEscalationLadder(incId, db, {
        step1DelayMs: 5000,
        step2DelayMs: 10000,
        autoExpireMs: 150,
      });

      await waitFor(
        () => {
          expect(screen.getByTestId('closed-status-screen')).toBeTruthy();
          expect(
            screen.getByText(/Alert expired automatically/i)
          ).toBeTruthy();
          expect(screen.getByText(/45-minute alert window ended/i)).toBeTruthy();
        },
        { timeout: 2000 }
      );

      // Verify backend rejects location samples once EXPIRED
      const locAfterExpire = await agent
        .post(`/api/incidents/${incId}/location`)
        .send({ lat: 28.61, lng: 77.2 });
      expect(locAfterExpire.status).toBe(400);
      expect(locAfterExpire.body.detail).toMatch(/EXPIRED/);

      // Part B: Verify duress incident auto-expiry still masks owner as CANCELLED while responder sees EXPIRED
      await agent
        .put('/api/settings/cancel-window')
        .send({ cancel_window_seconds: 5 });
      await agent
        .put('/api/settings/duress-pin')
        .send({ pin: '9999', cancel_pin: '1111' });

      const duressCreate = await agent
        .post('/api/incidents')
        .send({ client_request_id: 'req_duress_expire_1' });
      const duressIncId = duressCreate.body.incident.id;

      const duressCancel = await agent
        .post(`/api/incidents/${duressIncId}/cancel`)
        .send({ pin: '9999' });
      expect(duressCancel.status).toBe(200);
      expect(duressCancel.body.status).toBe('CANCELLED');

      // Trigger short auto-expiry on the duress incident
      scheduleEscalationLadder(duressIncId, db, {
        step1DelayMs: 5000,
        step2DelayMs: 10000,
        autoExpireMs: 100,
      });

      await new Promise((r) => setTimeout(r, 200));

      const ownerGet = await agent.get(`/api/incidents/${duressIncId}`);
      expect(ownerGet.body.incident.status).toBe('CANCELLED');

      const responderGet = await responderAgent.get(
        `/api/incidents/${duressIncId}`
      );
      expect(responderGet.body.incident.status).toBe('EXPIRED');
    } finally {
      config.incidentAutoExpireMinutes = originalAutoExpire;
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
  });

  it('10. Duress continuity: normal cancel never contains _duress_keep_location_active; duress cancel includes it and client keeps sending location samples silently without visible UI change', async () => {
    vi.restoreAllMocks();
    const tempDbPath = path.join(
      os.tmpdir(),
      `saathi-phase4a-duress-loc-${crypto.randomUUID()}.db`
    );
    const db = await initDatabase(`file:${tempDbPath}`);
    await seedDatabase(db);
    resetRateLimiter();

    const app = createApp();

    try {
      const agent = request.agent(app);
      const otpReq = await agent
        .post('/api/auth/otp/request')
        .send({ phone_e164: '+919000000001' });
      const verifyRes = await agent.post('/api/auth/otp/verify').send({
        phone_e164: '+919000000001',
        code: otpReq.body.dev_mock_hint,
      });

      // Grant location consent and configure cancel PIN (1111) + duress PIN (9999)
      await agent
        .post('/api/consents')
        .send({ type: 'location', granted: true, source: 'test' });
      await agent
        .put('/api/settings/duress-pin')
        .send({ pin: '9999', cancel_pin: '1111' });

      // 1. Normal cancel with 1111 -> must NOT contain _duress_keep_location_active
      const inc1 = await agent
        .post('/api/incidents')
        .send({ client_request_id: 'req_norm_cancel_1' });
      const normCancelRes = await agent
        .post(`/api/incidents/${inc1.body.incident.id}/cancel`)
        .send({ pin: '1111' });
      expect(normCancelRes.status).toBe(200);
      expect(normCancelRes.body.status).toBe('CANCELLED');
      expect('_duress_keep_location_active' in normCancelRes.body).toBe(false);

      // 2. Duress cancel in UI with 9999 -> includes _duress_keep_location_active: true and client streams location silently
      const meRes = await agent.get('/api/me');
      useAuthStore.setState({
        user: meRes.body,
        isLoading: false,
        toasts: [],
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
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

      const geoMock = vi.fn((success: PositionCallback) => {
        success({
          coords: {
            latitude: 19.076,
            longitude: 72.8777,
            accuracy: 9.5,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
            toJSON: () => ({}),
          },
          timestamp: Date.now(),
          toJSON: () => ({}),
        });
      });

      Object.defineProperty(globalThis.navigator, 'geolocation', {
        value: { getCurrentPosition: geoMock },
        configurable: true,
      });

      try {
        render(
          <MemoryRouter>
            <HomePage />
          </MemoryRouter>
        );

        await waitFor(() => {
          expect(screen.getByTestId('sos-hold-button')).toBeTruthy();
        });

        let duressIncId = '';
        await act(async () => {
          const created = await triggerSos('button');
          duressIncId = created.incident.id;
        });

        await waitFor(() => {
          expect(screen.getByTestId('cancel-alert-btn')).toBeTruthy();
        });

        // Tap Cancel Alert -> opens keypad immediately because user.has_duress_pin is true
        fireEvent.click(screen.getByTestId('cancel-alert-btn'));
        await waitFor(() => {
          expect(screen.getByTestId('pin-keypad')).toBeTruthy();
        });

        geoMock.mockClear();

        // Enter duress PIN 9999 and submit
        for (let i = 0; i < 4; i++) {
          fireEvent.click(screen.getByRole('button', { name: 'Digit 9' }));
        }
        fireEvent.click(screen.getByTestId('pin-submit-btn'));

        // UI transitions to normal-looking "Alert cancelled" screen with no location UI
        await waitFor(() => {
          expect(screen.getByTestId('closed-status-screen')).toBeTruthy();
          expect(screen.getByText(/Alert cancelled/i)).toBeTruthy();
          expect(screen.queryByText(/Accuracy:/i)).toBeNull();
        });

        // Click "Return to SOS Screen" -> UI looks completely idle, yet silent location sample was sent!
        fireEvent.click(screen.getByTestId('return-home-btn'));
        await waitFor(() => {
          expect(screen.getByTestId('sos-hold-button')).toBeTruthy();
          expect(geoMock).toHaveBeenCalled();
        });

        // Verify responder sees the silent location sample recorded on the duress incident
        const responderAgent = request.agent(app);
        const respOtp = await responderAgent
          .post('/api/auth/otp/request')
          .send({ phone_e164: '+919000000002' });
        await responderAgent.post('/api/auth/otp/verify').send({
          phone_e164: '+919000000002',
          code: respOtp.body.dev_mock_hint,
        });

        await waitFor(async () => {
          const responderView = await responderAgent.get(
            `/api/incidents/${duressIncId}`
          );
          expect(responderView.body.incident.is_duress).toBe(true);
          expect(responderView.body.incident.locations.length).toBeGreaterThanOrEqual(
            1
          );
          expect(responderView.body.incident.locations[0].lat).toBe(19.076);
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    } finally {
      clearAllScheduledTimers();
      await closeDatabase();
      for (const suffix of ['', '-wal', '-shm', '-journal']) {
        const candidate = `${tempDbPath}${suffix}`;
        if (fs.existsSync(candidate)) {
          fs.unlinkSync(candidate);
        }
      }
    }
  });

  it('11. /api/me DTO exposes cancel_window_seconds, has_cancel_pin, and has_duress_pin booleans and never exposes PIN hashes', async () => {
    const tempDbPath = path.join(
      os.tmpdir(),
      `saathi-phase4a-me-${crypto.randomUUID()}.db`
    );
    const db = await initDatabase(`file:${tempDbPath}`);
    await seedDatabase(db);
    resetRateLimiter();

    const app = createApp();

    try {
      const agent = request.agent(app);
      const otpReq = await agent
        .post('/api/auth/otp/request')
        .send({ phone_e164: '+919000000001' });
      await agent.post('/api/auth/otp/verify').send({
        phone_e164: '+919000000001',
        code: otpReq.body.dev_mock_hint,
      });

      const meBefore = await agent.get('/api/me');
      expect(meBefore.status).toBe(200);
      expect(meBefore.body.cancel_window_seconds).toBe(5);
      expect(meBefore.body.has_cancel_pin).toBe(false);
      expect(meBefore.body.has_duress_pin).toBe(false);
      expect(meBefore.body.cancelPinHash).toBeUndefined();
      expect(meBefore.body.duressPinHash).toBeUndefined();
      expect(meBefore.body.cancel_pin_hash).toBeUndefined();
      expect(meBefore.body.duress_pin_hash).toBeUndefined();

      await agent
        .put('/api/settings/cancel-window')
        .send({ cancel_window_seconds: 8 });
      await agent
        .put('/api/settings/duress-pin')
        .send({ pin: '9999', cancel_pin: '1234' });

      const meAfter = await agent.get('/api/me');
      expect(meAfter.status).toBe(200);
      expect(meAfter.body.cancel_window_seconds).toBe(8);
      expect(meAfter.body.has_cancel_pin).toBe(true);
      expect(meAfter.body.has_duress_pin).toBe(true);
      expect(meAfter.body.cancelPinHash).toBeUndefined();
      expect(meAfter.body.duressPinHash).toBeUndefined();
      expect(meAfter.body.cancel_pin_hash).toBeUndefined();
      expect(meAfter.body.duress_pin_hash).toBeUndefined();
    } finally {
      await closeDatabase();
      for (const suffix of ['', '-wal', '-shm', '-journal']) {
        const candidate = `${tempDbPath}${suffix}`;
        if (fs.existsSync(candidate)) {
          fs.unlinkSync(candidate);
        }
      }
    }
  });

  it('12. Follow-up 1: Auto-expiry after simulated server restart is computed from activated_at (remaining time, or expires immediately if already past)', async () => {
    const tempDbPath = path.join(
      os.tmpdir(),
      `saathi-phase4a-restart-expire-${crypto.randomUUID()}.db`
    );
    const db = await initDatabase(`file:${tempDbPath}`);
    await seedDatabase(db);
    resetRateLimiter();

    const app = createApp();

    try {
      const agent = request.agent(app);
      const otpReq = await agent
        .post('/api/auth/otp/request')
        .send({ phone_e164: '+919000000001' });
      await agent.post('/api/auth/otp/verify').send({
        phone_e164: '+919000000001',
        code: otpReq.body.dev_mock_hint,
      });

      await agent
        .put('/api/settings/cancel-window')
        .send({ cancel_window_seconds: 0 });

      // Case A: Incident activated 350ms ago with a 550ms autoExpireMs (~200ms remaining)
      const createRes1 = await agent
        .post('/api/incidents')
        .send({ client_request_id: 'req_restart_rem_1' });
      const incId1 = createRes1.body.incident.id;

      await new Promise((r) => setTimeout(r, 50));
      clearAllScheduledTimers();

      const past350msIso = new Date(Date.now() - 350).toISOString();
      await db
        .update(incidents)
        .set({ status: 'ACTIVE', activatedAt: past350msIso, closedAt: null })
        .where(eq(incidents.id, incId1));

      // Simulate restart with autoExpireMs = 550ms -> should expire in ~200ms (NOT 550ms)
      await recoverPendingIncidentsOnStartup(db, undefined, {
        step1DelayMs: 5000,
        step2DelayMs: 10000,
        autoExpireMs: 550,
      });

      // At +60ms (410ms since activated_at), still ACTIVE
      await new Promise((r) => setTimeout(r, 60));
      const checkMid = await agent.get(`/api/incidents/${incId1}`);
      expect(checkMid.body.incident.status).toBe('ACTIVE');

      // At +220ms (630ms since activated_at, well before a fresh 550ms from restart would have elapsed), must be EXPIRED!
      await new Promise((r) => setTimeout(r, 220));
      const checkExpired = await agent.get(`/api/incidents/${incId1}`);
      expect(checkExpired.body.incident.status).toBe('EXPIRED');

      // Case B: Incident whose activated_at is already past autoExpireMs on restart -> expires immediately
      clearAllScheduledTimers();
      const createRes2 = await agent
        .post('/api/incidents')
        .send({ client_request_id: 'req_restart_past_2' });
      const incId2 = createRes2.body.incident.id;

      await new Promise((r) => setTimeout(r, 40));
      clearAllScheduledTimers();

      const past2000msIso = new Date(Date.now() - 2000).toISOString();
      await db
        .update(incidents)
        .set({ status: 'ACTIVE', activatedAt: past2000msIso, closedAt: null })
        .where(eq(incidents.id, incId2));

      await recoverPendingIncidentsOnStartup(db, undefined, {
        step1DelayMs: 5000,
        step2DelayMs: 10000,
        autoExpireMs: 500,
      });

      const checkImmediate = await agent.get(`/api/incidents/${incId2}`);
      expect(checkImmediate.body.incident.status).toBe('EXPIRED');
    } finally {
      clearAllScheduledTimers();
      await closeDatabase();
      for (const suffix of ['', '-wal', '-shm', '-journal']) {
        const candidate = `${tempDbPath}${suffix}`;
        if (fs.existsSync(candidate)) {
          fs.unlinkSync(candidate);
        }
      }
    }
  });

  it('13. Follow-up 2: Triggering SOS again while a duress incident is still open shows a normal new alert flow to the owner while the real duress incident stays active', async () => {
    vi.restoreAllMocks();
    const tempDbPath = path.join(
      os.tmpdir(),
      `saathi-phase4a-duress-retrigger-${crypto.randomUUID()}.db`
    );
    const db = await initDatabase(`file:${tempDbPath}`);
    await seedDatabase(db);
    resetRateLimiter();

    const app = createApp();

    try {
      const agent = request.agent(app);
      const otpReq = await agent
        .post('/api/auth/otp/request')
        .send({ phone_e164: '+919000000001' });
      await agent.post('/api/auth/otp/verify').send({
        phone_e164: '+919000000001',
        code: otpReq.body.dev_mock_hint,
      });

      const responderAgent = request.agent(app);
      const respOtp = await responderAgent
        .post('/api/auth/otp/request')
        .send({ phone_e164: '+919000000002' });
      await responderAgent.post('/api/auth/otp/verify').send({
        phone_e164: '+919000000002',
        code: respOtp.body.dev_mock_hint,
      });

      await agent
        .put('/api/settings/cancel-window')
        .send({ cancel_window_seconds: 1 });
      await agent
        .put('/api/settings/duress-pin')
        .send({ pin: '9999', cancel_pin: '1111' });

      // 1. Trigger SOS #1 and enter duress PIN 9999
      const inc1Res = await agent
        .post('/api/incidents')
        .send({ client_request_id: 'req_duress_orig_1' });
      const realIncidentId = inc1Res.body.incident.id;

      const duressCancelRes = await agent
        .post(`/api/incidents/${realIncidentId}/cancel`)
        .send({ pin: '9999' });
      expect(duressCancelRes.body.status).toBe('CANCELLED');

      // Wait 1.1s so the real duress incident activates in the background
      await new Promise((r) => setTimeout(r, 1100));
      const responderCheck1 = await responderAgent.get(
        `/api/incidents/${realIncidentId}`
      );
      expect(responderCheck1.body.incident.status).toBe('ACTIVE');

      // 2. Now user triggers SOS again in the UI while realIncidentId is still open under duress
      const meRes = await agent.get('/api/me');
      useAuthStore.setState({
        user: meRes.body,
        isLoading: false,
        toasts: [],
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
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

      try {
        render(
          <MemoryRouter>
            <HomePage />
          </MemoryRouter>
        );

        await waitFor(() => {
          expect(screen.getByTestId('sos-hold-button')).toBeTruthy();
        });

        let secondTriggerRes: any;
        await act(async () => {
          secondTriggerRes = await triggerSos('button');
        });

        // Owner sees a normal new TRIGGERED cancel window (NOT a pre-cancelled screen!)
        expect(secondTriggerRes.merged_into_existing).toBe(true);
        expect(secondTriggerRes.incident.status).toBe('TRIGGERED');
        expect(secondTriggerRes.incident.merged_into_id).toBe(realIncidentId);

        await waitFor(() => {
          expect(screen.getByTestId('cancel-window-screen')).toBeTruthy();
        });

        // After the 1s cancel window elapses, the owner sees the normal Live Status screen!
        await waitFor(
          () => {
            expect(screen.getByTestId('live-status-screen')).toBeTruthy();
          },
          { timeout: 2500 }
        );

        // And the real incident stays the one that is active in the backend
        const responderCheck2 = await responderAgent.get(
          `/api/incidents/${realIncidentId}`
        );
        expect(responderCheck2.body.incident.id).toBe(realIncidentId);
        expect(responderCheck2.body.incident.status).toBe('ACTIVE');
      } finally {
        globalThis.fetch = originalFetch;
      }
    } finally {
      clearAllScheduledTimers();
      await closeDatabase();
      for (const suffix of ['', '-wal', '-shm', '-journal']) {
        const candidate = `${tempDbPath}${suffix}`;
        if (fs.existsSync(candidate)) {
          fs.unlinkSync(candidate);
        }
      }
    }
  });
});
