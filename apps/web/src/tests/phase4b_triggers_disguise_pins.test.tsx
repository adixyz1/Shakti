import { defaultOtpProvider } from '../../../../apps/api/src/providers/otp';
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
import { SettingsPage } from '../pages/SettingsPage';
import { DiscreetTriggersManager } from '../components/DiscreetTriggersManager';
import { useAuthStore } from '../store/authStore';
import { useTriggerSettingsStore } from '../store/triggerSettingsStore';
import * as apiModule from '../lib/api';
import * as sosModule from '../lib/sos';
import { createApp } from '../../../api/server';
import { initDatabase, closeDatabase } from '../../../api/src/core/db';
import { seedDatabase } from '../../../api/src/core/seed';
import { resetRateLimiter } from '../../../api/src/core/middleware';
import { clearAllScheduledTimers } from '../../../api/src/services/scheduler';
import { attachWebSocketHub } from '../../../api/src/services/wsHub';

const mockUser: any = {
  id: 'usr_4b_1',
  phone_e164: '+919000000001',
  name: 'Aarohi Sharma',
  role: 'user',
  language: 'en',
  created_at: new Date().toISOString(),
  cancel_window_seconds: 5,
  has_cancel_pin: false,
  has_duress_pin: false,
};

function makeTriggeredIncident(
  overrides: Partial<apiModule.IncidentDto> = {}
): apiModule.IncidentDto {
  return {
    id: 'inc_4b_1',
    user_id: mockUser.id,
    status: 'TRIGGERED',
    emergency_type: null,
    client_request_id: 'req_4b_1',
    created_at: new Date().toISOString(),
    activated_at: null,
    closed_at: null,
    merged_into_id: null,
    source_trigger: 'button',
    is_duress: false,
    needs_user_action: false,
    escalation_stage: 0,
    auto_expire_minutes: 60,
    notifiable_contacts_count: 1,
    ...overrides,
  };
}

describe('SAATHI Phase 4B Web Tests (Discreet Triggers, Disguise Mode & PIN Settings)', () => {
  beforeEach(async () => {
    process.env.DEMO_MODE = 'true';
    vi.restoreAllMocks();
    window.localStorage.clear();
    await i18n.changeLanguage('en');

    useAuthStore.setState({
      user: { ...mockUser },
      isLoading: false,
      darkMode: false,
      toasts: [],
    });

    useTriggerSettingsStore.getState().resetTriggerSettings();
    sosModule.setPracticeModeTarget(null);

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
  });

  afterEach(() => {
    vi.useRealTimers();
    sosModule.setPracticeModeTarget(null);
  });

  it('1. Triple-tap trigger timing: 3 taps within 1s calls triggerSos("triple_tap"), while 3 taps spread over >1s does nothing', async () => {
    vi.useFakeTimers();

    const createIncidentSpy = vi
      .spyOn(apiModule.incidentsApi, 'createIncident')
      .mockImplementation(async (payload) => ({
        incident: makeTriggeredIncident({
          source_trigger: payload.source_trigger || 'triple_tap',
        }),
        idempotent_replay: false,
        merged_into_existing: false,
        notifiable_contacts_count: 1,
      }));

    render(
      <MemoryRouter initialEntries={['/home']}>
        <DiscreetTriggersManager />
        <Routes>
          <Route path="/home" element={<HomePage />} />
        </Routes>
      </MemoryRouter>
    );

    await act(async () => {
      await Promise.resolve();
    });

    const logoZone = screen.getByTestId('triple-tap-zone-logo');

    // Part A: 3 taps spread over 1.4 seconds (> 1000ms window) -> must NOT trigger
    fireEvent.click(logoZone);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    fireEvent.click(logoZone);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    fireEvent.click(logoZone);
    expect(createIncidentSpy).not.toHaveBeenCalled();

    // Wait 1.2s to clear tap buffer
    act(() => {
      vi.advanceTimersByTime(1200);
    });

    // Part B: 3 taps within 400ms (<= 1000ms window) -> triggers SOS with source 'triple_tap'
    fireEvent.click(logoZone);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    fireEvent.click(logoZone);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    await act(async () => {
      fireEvent.click(logoZone);
      await Promise.resolve();
    });

    expect(createIncidentSpy).toHaveBeenCalledTimes(1);
    expect(createIncidentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        source_trigger: 'triple_tap',
      }),
      undefined
    );
  });

  it('2. Keyboard shortcut trigger: pressing configured key combo calls triggerSos("keyboard_shortcut")', async () => {
    const createIncidentSpy = vi
      .spyOn(apiModule.incidentsApi, 'createIncident')
      .mockImplementation(async (payload) => ({
        incident: makeTriggeredIncident({
          source_trigger: payload.source_trigger || 'keyboard_shortcut',
        }),
        idempotent_replay: false,
        merged_into_existing: false,
        notifiable_contacts_count: 1,
      }));

    useTriggerSettingsStore.getState().setShortcutEnabled(true);
    useTriggerSettingsStore.getState().setShortcutCombo('Shift+Escape');

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
    });

    // Plain Escape without Shift does nothing
    fireEvent.keyDown(window, { key: 'Escape', shiftKey: false });
    expect(createIncidentSpy).not.toHaveBeenCalled();

    // Shift+Escape triggers SOS with source 'keyboard_shortcut'
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape', shiftKey: true });
    });

    await waitFor(() => {
      expect(createIncidentSpy).toHaveBeenCalledTimes(1);
      expect(createIncidentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          source_trigger: 'keyboard_shortcut',
        }),
        undefined
      );
      expect(screen.getByTestId('cancel-window-screen')).toBeTruthy();
    });
  });

  it('3. Shake detection trigger: simulated DeviceMotion events below threshold do nothing, at/above threshold call triggerSos("shake"), and iOS permission is handled', async () => {
    const createIncidentSpy = vi
      .spyOn(apiModule.incidentsApi, 'createIncident')
      .mockImplementation(async (payload) => ({
        incident: makeTriggeredIncident({
          source_trigger: payload.source_trigger || 'shake',
        }),
        idempotent_replay: false,
        merged_into_existing: false,
        notifiable_contacts_count: 1,
      }));

    // Simulate DeviceMotionEvent support with iOS requestPermission
    const requestPermissionMock = vi.fn().mockResolvedValue('granted');
    (window as any).DeviceMotionEvent = class MockDeviceMotionEvent extends Event {
      static requestPermission = requestPermissionMock;
    };

    useTriggerSettingsStore.getState().setShakeThreshold(25);

    render(
      <MemoryRouter initialEntries={['/settings']}>
        <DiscreetTriggersManager />
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/home" element={<HomePage />} />
        </Routes>
      </MemoryRouter>
    );

    // Click iOS permission button in Settings
    const iosPermBtn = await screen.findByTestId(
      'request-ios-shake-permission-btn'
    );
    await act(async () => {
      fireEvent.click(iosPermBtn);
    });
    expect(requestPermissionMock).toHaveBeenCalledTimes(1);
    expect(useTriggerSettingsStore.getState().shakeEnabled).toBe(true);

    // 1. Sub-threshold motion (magnitude = sqrt(10^2 + 10^2 + 5^2) = 15 < 25) -> does nothing
    const weakMotion = new Event('devicemotion') as any;
    weakMotion.accelerationIncludingGravity = { x: 10, y: 10, z: 5 };
    act(() => {
      window.dispatchEvent(weakMotion);
    });
    expect(createIncidentSpy).not.toHaveBeenCalled();

    // 2. Above-threshold motion (magnitude = sqrt(20^2 + 20^2 + 10^2) = 30 >= 25) -> calls triggerSos('shake')
    const strongMotion = new Event('devicemotion') as any;
    strongMotion.accelerationIncludingGravity = { x: 20, y: 20, z: 10 };
    await act(async () => {
      window.dispatchEvent(strongMotion);
    });

    await waitFor(() => {
      expect(createIncidentSpy).toHaveBeenCalledTimes(1);
      expect(createIncidentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          source_trigger: 'shake',
        }),
        undefined
      );
    });
  });

  it('4. Voice code word trigger (experimental): has NO default codeword, requires explicit microphone consent + user-configured codeword (min 6 chars, confirm entry, salted PBKDF2 hash stored without plain text), and calls triggerSos("voice") when code word is spoken', async () => {
    const createIncidentSpy = vi
      .spyOn(apiModule.incidentsApi, 'createIncident')
      .mockImplementation(async (payload) => ({
        incident: makeTriggeredIncident({
          source_trigger: payload.source_trigger || 'voice',
        }),
        idempotent_replay: false,
        merged_into_existing: false,
        notifiable_contacts_count: 1,
      }));
    const postConsentSpy = vi
      .spyOn(apiModule.consentsApi, 'postConsent')
      .mockResolvedValue({} as any);

    let activeRecognitionInstance: any = null;
    class MockSpeechRecognition {
      continuous = false;
      interimResults = false;
      lang = 'en-IN';
      onresult: ((e: any) => void) | null = null;
      onerror: ((e: any) => void) | null = null;
      start = vi.fn(() => {
        activeRecognitionInstance = this;
      });
      stop = vi.fn();
    }
    (window as any).SpeechRecognition = MockSpeechRecognition;

    // Verify off by default, consent false by default, and NO default codeword hash
    expect(useTriggerSettingsStore.getState().voiceEnabled).toBe(false);
    expect(useTriggerSettingsStore.getState().voiceConsentGranted).toBe(false);
    expect(useTriggerSettingsStore.getState().voiceCodewordHash).toBeNull();

    // Attempting to enable voice trigger without a codeword hash is rejected by store
    useTriggerSettingsStore.getState().setVoiceEnabled(true);
    expect(useTriggerSettingsStore.getState().voiceEnabled).toBe(false);

    render(
      <MemoryRouter initialEntries={['/settings']}>
        <DiscreetTriggersManager />
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/home" element={<HomePage />} />
        </Routes>
      </MemoryRouter>
    );

    // Follow-up 2 check: Disguise-mode settings screen shows the home screen installation note in EN and HI
    expect(screen.getByTestId('disguise-install-note').textContent).toContain(
      'If you add the app to your home screen, give it a neutral name during installation. The installed name and icon cannot be changed afterwards.'
    );
    await act(async () => {
      await i18n.changeLanguage('hi');
    });
    expect(screen.getByTestId('disguise-install-note').textContent).toContain(
      'यदि आप ऐप को अपनी होम स्क्रीन पर जोड़ती हैं, तो इंस्टॉलेशन के दौरान इसे एक सामान्य (तटस्थ) नाम दें।'
    );
    await act(async () => {
      await i18n.changeLanguage('en');
    });

    // Clearly labeled experimental
    expect(screen.getByTestId('voice-experimental-label').textContent).toMatch(
      /Experimental — may not work on all devices/i
    );

    // Toggle is not shown until explicit microphone consent step is completed
    expect(screen.queryByTestId('toggle-voice')).toBeNull();
    const consentBtn = screen.getByTestId('grant-voice-consent-btn');
    await act(async () => {
      fireEvent.click(consentBtn);
    });
    expect(postConsentSpy).toHaveBeenCalledWith({
      type: 'microphone',
      granted: true,
      source: 'settings_voice_trigger',
    });

    // Trying to toggle voice ON before setting a custom codeword prompts error
    const voiceToggle = await screen.findByTestId('toggle-voice');
    fireEvent.click(voiceToggle);
    expect(useTriggerSettingsStore.getState().voiceEnabled).toBe(false);
    expect(screen.getByTestId('voice-codeword-error').textContent).toMatch(
      /no default code word/i
    );

    // Reject codeword shorter than 6 characters
    const wordInput = screen.getByTestId('voice-codeword-input');
    const confirmInput = screen.getByTestId('voice-codeword-confirm-input');
    const saveWordBtn = screen.getByTestId('save-voice-codeword-btn');

    fireEvent.change(wordInput, { target: { value: 'short' } });
    fireEvent.change(confirmInput, { target: { value: 'short' } });
    fireEvent.click(saveWordBtn);
    expect(screen.getByTestId('voice-codeword-error').textContent).toMatch(
      /at least 6 characters/i
    );

    // Reject mismatched confirmation
    fireEvent.change(wordInput, { target: { value: 'crimson lotus' } });
    fireEvent.change(confirmInput, { target: { value: 'crimson river' } });
    fireEvent.click(saveWordBtn);
    expect(screen.getByTestId('voice-codeword-error').textContent).toMatch(
      /does not match/i
    );

    // Valid custom codeword 'crimson lotus' (length 13 >= 6) with matching confirmation saves PBKDF2 hash and enables voice trigger
    fireEvent.change(wordInput, { target: { value: 'crimson lotus' } });
    fireEvent.change(confirmInput, { target: { value: 'crimson lotus' } });
    await act(async () => {
      fireEvent.click(saveWordBtn);
    });

    await waitFor(() => {
      expect(useTriggerSettingsStore.getState().voiceEnabled).toBe(true);
    });

    const storedVoiceHash =
      useTriggerSettingsStore.getState().voiceCodewordHash;
    expect(storedVoiceHash).toBeTruthy();
    expect(storedVoiceHash).toMatch(
      /^pbkdf2\$200000\$[0-9a-f]{32}\$[0-9a-f]{64}\$13$/
    );

    // Verify localStorage NEVER contains the plain codeword 'crimson lotus'
    const rawStorage = window.localStorage.getItem(
      'saathi_trigger_settings_v1'
    );
    expect(rawStorage).toBeTruthy();
    expect(rawStorage).not.toContain('crimson lotus');
    expect(rawStorage).not.toContain('saathi help');
    expect(rawStorage).toContain(storedVoiceHash!);

    expect(activeRecognitionInstance).toBeTruthy();

    // Simulate speech transcript matching "crimson lotus"
    await act(async () => {
      activeRecognitionInstance.onresult({
        resultIndex: 0,
        results: [[{ transcript: 'please crimson lotus right now' }]],
      });
    });

    await waitFor(() => {
      expect(createIncidentSpy).toHaveBeenCalledTimes(1);
      expect(createIncidentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          source_trigger: 'voice',
        }),
        undefined
      );
    });

    delete (window as any).SpeechRecognition;
  });

  it('5. Disguise mode: changes page title & icon, calculator actually calculates math, and secret sequence reveals the real SOS screen', async () => {
    await useTriggerSettingsStore.getState().configureDisguiseSequence('112181=');
    useTriggerSettingsStore.getState().setDisguiseEnabled(true);

    render(
      <MemoryRouter initialEntries={['/home']}>
        <DiscreetTriggersManager />
        <Routes>
          <Route path="/home" element={<HomePage />} />
        </Routes>
      </MemoryRouter>
    );

    // 1. Verify calculator screen is shown, SOS button is hidden, and document.title changed to "Calculator"
    await waitFor(() => {
      expect(screen.getByTestId('disguise-calculator')).toBeTruthy();
      expect(screen.queryByTestId('sos-hold-button')).toBeNull();
      expect(document.title).toBe('Calculator');
    });

    const iconLink = document.querySelector(
      'link[rel="icon"]'
    ) as HTMLLinkElement | null;
    expect(iconLink?.href).toContain('data:image/svg+xml');

    // 2. Verify calculator actually performs real math: 7 + 8 = 15, then × 3 = 45
    fireEvent.click(screen.getByTestId('calc-key-7'));
    fireEvent.click(screen.getByTestId('calc-key-+'));
    fireEvent.click(screen.getByTestId('calc-key-8'));
    fireEvent.click(screen.getByTestId('calc-key-='));
    expect(screen.getByTestId('calc-display').textContent).toBe('15');

    fireEvent.click(screen.getByTestId('calc-key-×'));
    fireEvent.click(screen.getByTestId('calc-key-3'));
    fireEvent.click(screen.getByTestId('calc-key-='));
    expect(screen.getByTestId('calc-display').textContent).toBe('45');

    // Clear calculator
    fireEvent.click(screen.getByTestId('calc-key-C'));
    expect(screen.getByTestId('calc-display').textContent).toBe('0');

    // 3. Enter secret unlock sequence: 1, 1, 2, 1, 8, 1, = -> reveals real SOS screen and restores title
    fireEvent.click(screen.getByTestId('calc-key-1'));
    fireEvent.click(screen.getByTestId('calc-key-1'));
    fireEvent.click(screen.getByTestId('calc-key-2'));
    fireEvent.click(screen.getByTestId('calc-key-1'));
    fireEvent.click(screen.getByTestId('calc-key-8'));
    fireEvent.click(screen.getByTestId('calc-key-1'));
    fireEvent.click(screen.getByTestId('calc-key-='));

    await waitFor(() => {
      expect(screen.getByTestId('sos-hold-button')).toBeTruthy();
      expect(screen.queryByTestId('disguise-calculator')).toBeNull();
      expect(document.title).toContain('SHAKTI');
    });
  });

  it('6. PIN settings & Practice mode: rejects matching Cancel/Duress PINs, never stores PINs in browser storage, and practice mode fires trigger without creating an incident', async () => {
    const createIncidentSpy = vi.spyOn(
      apiModule.incidentsApi,
      'createIncident'
    );
    const updateCancelPinSpy = vi
      .spyOn(apiModule.settingsApi, 'updateCancelPin')
      .mockResolvedValue({ cancel_pin_configured: true });
    const updateDuressPinSpy = vi
      .spyOn(apiModule.settingsApi, 'updateDuressPin')
      .mockResolvedValue({ duress_pin_configured: true });
    vi.spyOn(apiModule.authApi, 'getMe').mockResolvedValue({
      ...mockUser,
      has_cancel_pin: true,
    });

    render(
      <MemoryRouter initialEntries={['/settings']}>
        <DiscreetTriggersManager />
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/home" element={<HomePage />} />
        </Routes>
      </MemoryRouter>
    );

    // 1. Set Cancel PIN to 1234 (Step 1 -> Confirm Step 2 -> Save)
    fireEvent.click(screen.getByTestId('open-cancel-pin-setup-btn'));
    for (const d of ['1', '2', '3', '4']) {
      fireEvent.click(screen.getByTestId(`settings-pin-digit-${d}`));
    }
    fireEvent.click(screen.getByTestId('settings-pin-submit-btn'));

    // Step 2: Confirm 1234
    for (const d of ['1', '2', '3', '4']) {
      fireEvent.click(screen.getByTestId(`settings-pin-digit-${d}`));
    }
    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-pin-submit-btn'));
    });

    expect(updateCancelPinSpy).toHaveBeenCalledWith('1234');

    // 2. Try to set Duress PIN to the SAME value 1234 -> must be rejected with clear error!
    fireEvent.click(screen.getByTestId('open-duress-pin-setup-btn'));
    for (const d of ['1', '2', '3', '4']) {
      fireEvent.click(screen.getByTestId(`settings-pin-digit-${d}`));
    }
    fireEvent.click(screen.getByTestId('settings-pin-submit-btn'));

    expect(screen.getByTestId('settings-pin-error').textContent).toMatch(
      /Cancel PIN and Duress PIN must be different/i
    );
    expect(updateDuressPinSpy).not.toHaveBeenCalled();

    // 3. Verify PINs are NEVER stored in localStorage or sessionStorage
    const allLocal = JSON.stringify(window.localStorage);
    const allSession = JSON.stringify(window.sessionStorage);
    expect(allLocal).not.toContain('1234');
    expect(allSession).not.toContain('1234');

    // 4. Practice Mode: click "Test in Practice Mode" for keyboard shortcut -> press Shift+Escape -> practice banner succeeds & createIncident is NEVER called!
    fireEvent.click(screen.getByTestId('practice-shortcut-btn'));
    expect(screen.getByTestId('practice-active-banner')).toBeTruthy();

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape', shiftKey: true });
    });

    await waitFor(() => {
      expect(screen.getByTestId('practice-success-banner').textContent).toMatch(
        /keyboard_shortcut/i
      );
    });
    expect(createIncidentSpy).not.toHaveBeenCalled();
  });

  it('7. Full E2E verification (JSDOM 390x844 connected to real Express + SQLite + WebSocket): Disguise unlock -> Triple-tap trigger reaches cancel window -> Duress PIN cancel looks normal while incident continues on server + Hindi strings check', async () => {
    vi.restoreAllMocks();
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
      `saathi-phase4b-e2e-${crypto.randomUUID()}.db`
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
        code: (otpReq.body.dev_mock_hint || (defaultOtpProvider as any).lastOtpCode || "123456"),
      });
      const setCookieHeader = verifyRes.headers['set-cookie'];
      const cookieStr = Array.isArray(setCookieHeader)
        ? setCookieHeader.map((c: string) => c.split(';')[0]).join('; ')
        : String(setCookieHeader || '').split(';')[0];

      // Responder login to verify real server state after duress cancel
      const responderAgent = request.agent(baseUrl);
      responderAgent.set('Origin', baseUrl);
      const respOtp = await responderAgent
        .post('/api/auth/otp/request')
        .send({ phone_e164: '+919000000002' });
      await responderAgent.post('/api/auth/otp/verify').send({
        phone_e164: '+919000000002',
        code: (respOtp.body.dev_mock_hint || (defaultOtpProvider as any).lastOtpCode || "123456"),
      });

      // Configure 2s cancel window, Cancel PIN = 1234, Duress PIN = 9999 via real API
      await agent
        .put('/api/settings/cancel-window')
        .send({ cancel_window_seconds: 2 });
      await agent
        .put('/api/settings/duress-pin')
        .send({ pin: '9999', cancel_pin: '1234' });

      const meRes = await agent.get('/api/me');
      useAuthStore.setState({
        user: meRes.body,
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

      // Enable Disguise Mode with secret sequence '112181=' (stored as PBKDF2 hash with 200,000 iterations)
      useTriggerSettingsStore.getState().resetTriggerSettings();
      await useTriggerSettingsStore
        .getState()
        .configureDisguiseSequence('112181=');
      useTriggerSettingsStore.getState().setDisguiseEnabled(true);

      render(
        <MemoryRouter initialEntries={['/home']}>
          <DiscreetTriggersManager />
          <Routes>
            <Route path="/home" element={<HomePage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </MemoryRouter>
      );

      // Step 1: Disguise mode calculator is shown
      await waitFor(() => {
        expect(screen.getByTestId('disguise-calculator')).toBeTruthy();
      });

      // Unlock calculator with '112181='
      fireEvent.click(screen.getByTestId('calc-key-1'));
      fireEvent.click(screen.getByTestId('calc-key-1'));
      fireEvent.click(screen.getByTestId('calc-key-2'));
      fireEvent.click(screen.getByTestId('calc-key-1'));
      fireEvent.click(screen.getByTestId('calc-key-8'));
      fireEvent.click(screen.getByTestId('calc-key-1'));
      fireEvent.click(screen.getByTestId('calc-key-='));

      await waitFor(() => {
        expect(screen.getByTestId('sos-hold-button')).toBeTruthy();
      });

      // Step 2: Triple-tap the logo zone to trigger SOS
      let createdIncidentId = '';
      const unsub = sosModule.subscribeSosTrigger((res) => {
        createdIncidentId = res.incident.id;
      });
      const logoZone = screen.getByTestId('triple-tap-zone-logo');
      fireEvent.click(logoZone);
      fireEvent.click(logoZone);
      fireEvent.click(logoZone);

      // Verify Cancel Window screen is reached
      await waitFor(() => {
        expect(screen.getByTestId('cancel-window-screen')).toBeTruthy();
        expect(createdIncidentId).toBeTruthy();
      });
      unsub();

      // Step 3: Tap Cancel Alert -> opens numeric PIN keypad -> enter Duress PIN 9999
      fireEvent.click(screen.getByTestId('cancel-alert-btn'));
      await waitFor(() => {
        expect(screen.getByTestId('pin-keypad')).toBeTruthy();
      });

      for (let i = 0; i < 4; i++) {
        fireEvent.click(screen.getByRole('button', { name: 'Digit 9' }));
      }
      fireEvent.click(screen.getByTestId('pin-submit-btn'));

      // Owner UI looks completely normal ("Alert cancelled")
      await waitFor(() => {
        expect(screen.getByTestId('closed-status-screen')).toBeTruthy();
        expect(screen.getByText(/Alert cancelled/i)).toBeTruthy();
      });

      // Step 4: Wait for 2s cancel window to elapse on the server and verify responder sees real ACTIVE incident with source_trigger='triple_tap' and is_duress=true!
      await new Promise((r) => setTimeout(r, 2200));

      const activeCheckOwner = await agent.get('/api/incidents/active');
      expect(activeCheckOwner.body.incident).toBeNull(); // Masked for owner

      const responderGet = await responderAgent.get(
        `/api/responder/incidents/${createdIncidentId}`
      );
      expect(responderGet.status).toBe(200);
      expect(responderGet.body.incident.status).toBe('ACTIVE');
      expect(responderGet.body.incident.is_duress).toBe(true);
      expect(responderGet.body.incident.source_trigger).toBe('triple_tap');

      // Check Hindi translations for Phase 4B Settings keys
      await act(async () => {
        await i18n.changeLanguage('hi');
      });
      expect(i18n.t('settings.safetyWordingTitle')).toContain(
        'महत्वपूर्ण सुरक्षा और ट्रिगर सूचना'
      );
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

  it('8. Fix 1 & Fix D: Disguise mode has NO default secret sequence, requires user to set & confirm her own sequence (min length 6), and stores only a PBKDF2 hash (200,000 iterations + random salt) on-device (never plain text in localStorage)', async () => {
    useTriggerSettingsStore.getState().resetTriggerSettings();

    // 1. Verify NO default secret sequence exists
    expect(useTriggerSettingsStore.getState().disguiseSequenceHash).toBeNull();
    expect(useTriggerSettingsStore.getState().disguiseEnabled).toBe(false);

    // Attempting to enable disguise mode without a sequence is rejected by store
    useTriggerSettingsStore.getState().setDisguiseEnabled(true);
    expect(useTriggerSettingsStore.getState().disguiseEnabled).toBe(false);

    render(
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </MemoryRouter>
    );

    // 2. Trying to toggle disguise mode ON in UI prompts user to set & confirm her own sequence first
    const toggle = screen.getByTestId(
      'toggle-disguise-mode'
    ) as HTMLInputElement;
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(false);
    expect(screen.getByTestId('disguise-sequence-error').textContent).toMatch(
      /no default sequence/i
    );

    // 3. Reject sequence shorter than 6 characters
    const seqInput = screen.getByTestId('disguise-secret-input');
    const confirmInput = screen.getByTestId('disguise-secret-confirm-input');
    const saveBtn = screen.getByTestId('save-disguise-sequence-btn');

    fireEvent.change(seqInput, { target: { value: '2580=' } });
    fireEvent.change(confirmInput, { target: { value: '2580=' } });
    fireEvent.click(saveBtn);
    expect(screen.getByTestId('disguise-sequence-error').textContent).toMatch(
      /at least 6 characters/i
    );

    // 4. Reject mismatched confirmation sequence
    fireEvent.change(seqInput, { target: { value: '258012=' } });
    fireEvent.change(confirmInput, { target: { value: '258099=' } });
    fireEvent.click(saveBtn);
    expect(screen.getByTestId('disguise-sequence-error').textContent).toMatch(
      /does not match/i
    );

    // 5. Valid custom sequence '258012=' (length 7 >= 6) with matching confirmation saves PBKDF2 (200000 iterations) hash and enables disguise mode
    fireEvent.change(seqInput, { target: { value: '258012=' } });
    fireEvent.change(confirmInput, { target: { value: '258012=' } });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(useTriggerSettingsStore.getState().disguiseEnabled).toBe(true);
    });

    const storedHash = useTriggerSettingsStore.getState().disguiseSequenceHash;
    expect(storedHash).toBeTruthy();
    expect(storedHash).toMatch(
      /^pbkdf2\$200000\$[0-9a-f]{32}\$[0-9a-f]{64}\$7$/
    );

    // Verify localStorage NEVER contains the plain sequence '258012='
    const rawStorage = window.localStorage.getItem(
      'saathi_trigger_settings_v1'
    );
    expect(rawStorage).toBeTruthy();
    expect(rawStorage).not.toContain('258012=');
    expect(rawStorage).toContain(storedHash!);
  });

  it('9. Fix 2: On an incident with is_duress = true, the owner\'s "I\'m safe" (resolve) does NOT close the real incident (shows normal closed screen to owner, stays active on server until responder closes it)', async () => {
    vi.restoreAllMocks();
    const tempDbPath = path.join(
      os.tmpdir(),
      `saathi-phase4b-fix2-${crypto.randomUUID()}.db`
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
      const ownerAgent = request.agent(baseUrl);
      ownerAgent.set('Origin', baseUrl);
      const otp1 = await ownerAgent
        .post('/api/auth/otp/request')
        .send({ phone_e164: '+919000000001' });
      await ownerAgent.post('/api/auth/otp/verify').send({
        phone_e164: '+919000000001',
        code: (otp1.body.dev_mock_hint || "123456"),
      });

      const responderAgent = request.agent(baseUrl);
      responderAgent.set('Origin', baseUrl);
      const otp2 = await responderAgent
        .post('/api/auth/otp/request')
        .send({ phone_e164: '+919000000002' });
      await responderAgent.post('/api/auth/otp/verify').send({
        phone_e164: '+919000000002',
        code: (otp2.body.dev_mock_hint || "123456"),
      });

      await ownerAgent
        .put('/api/settings/cancel-window')
        .send({ cancel_window_seconds: 2 });
      await ownerAgent
        .put('/api/settings/duress-pin')
        .send({ pin: '9999', cancel_pin: '1234' });

      // Trigger incident and cancel with Duress PIN 9999
      const createRes = await ownerAgent.post('/api/incidents').send({
        client_request_id: 'req_fix2_duress',
        client_created_at: new Date().toISOString(),
        source_trigger: 'button',
      });
      const incidentId = createRes.body.incident.id;

      await ownerAgent
        .post(`/api/incidents/${incidentId}/cancel`)
        .send({ pin: '9999' });

      // Wait for activation
      await new Promise((r) => setTimeout(r, 2200));

      // Owner attempts "I'm safe" (POST /api/incidents/:id/resolve) directly on the duress incident
      const ownerResolveRes = await ownerAgent
        .post(`/api/incidents/${incidentId}/resolve`)
        .send({ resolution: 'RESOLVED' });

      // Owner sees a normal-looking RESOLVED response
      expect(ownerResolveRes.status).toBe(200);
      expect(ownerResolveRes.body.incident.status).toBe('RESOLVED');
      expect(ownerResolveRes.body.incident.is_duress).toBe(false);

      // Verify on server via responder that the real duress incident was NOT closed!
      const responderCheck = await responderAgent.get(
        `/api/responder/incidents/${incidentId}`
      );
      expect(responderCheck.status).toBe(200);
      expect(responderCheck.body.incident.status).toBe('ACTIVE');
      expect(responderCheck.body.incident.is_duress).toBe(true);
      expect(responderCheck.body.incident.closed_at).toBeNull();

      // Now responder resolves the incident -> real incident is closed
      const responderResolve = await responderAgent
        .post(`/api/responder/incidents/${incidentId}/resolve`)
        .send({ resolution: 'RESOLVED', note: 'Verified safe by responder' });
      expect(responderResolve.status).toBe(200);
      expect(responderResolve.body.incident.status).toBe('RESOLVED');
      expect(responderResolve.body.incident.closed_at).toBeTruthy();
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

  it('10. Fix 3: Shadow alert from re-triggering during a duress incident sends NO second set of notifications, and "Cancel" or "I\'m safe" on the shadow flow never affects the real duress incident', async () => {
    vi.restoreAllMocks();
    const tempDbPath = path.join(
      os.tmpdir(),
      `saathi-phase4b-fix3-${crypto.randomUUID()}.db`
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
      const ownerAgent = request.agent(baseUrl);
      ownerAgent.set('Origin', baseUrl);
      const otp1 = await ownerAgent
        .post('/api/auth/otp/request')
        .send({ phone_e164: '+919000000001' });
      await ownerAgent.post('/api/auth/otp/verify').send({
        phone_e164: '+919000000001',
        code: (otp1.body.dev_mock_hint || "123456"),
      });

      const responderAgent = request.agent(baseUrl);
      responderAgent.set('Origin', baseUrl);
      const otp2 = await responderAgent
        .post('/api/auth/otp/request')
        .send({ phone_e164: '+919000000002' });
      await responderAgent.post('/api/auth/otp/verify').send({
        phone_e164: '+919000000002',
        code: (otp2.body.dev_mock_hint || "123456"),
      });

      await ownerAgent
        .put('/api/settings/cancel-window')
        .send({ cancel_window_seconds: 1 });
      await ownerAgent
        .put('/api/settings/duress-pin')
        .send({ pin: '9999', cancel_pin: '1234' });

      // 1. Trigger primary incident and enter Duress PIN 9999
      const primaryRes = await ownerAgent.post('/api/incidents').send({
        client_request_id: 'req_fix3_primary',
        client_created_at: new Date().toISOString(),
        source_trigger: 'button',
      });
      const realIncidentId = primaryRes.body.incident.id;

      await ownerAgent
        .post(`/api/incidents/${realIncidentId}/cancel`)
        .send({ pin: '9999' });

      // Wait for real duress incident to activate and send its initial notifications
      await new Promise((r) => setTimeout(r, 1300));

      const outboxBeforeShadow = await ownerAgent.get('/api/dev/outbox');
      const countBeforeShadow = outboxBeforeShadow.body.messages.length;

      // 2. Owner re-triggers SOS (Shadow alert #1) and cancels it with her real Cancel PIN 1234
      const shadow1Res = await ownerAgent.post('/api/incidents').send({
        client_request_id: 'req_fix3_shadow_1',
        client_created_at: new Date().toISOString(),
        source_trigger: 'button',
      });
      const shadow1Id = shadow1Res.body.incident.id;
      expect(shadow1Id).not.toBe(realIncidentId);
      expect(shadow1Res.body.incident.status).toBe('TRIGGERED');

      const cancelShadow1 = await ownerAgent
        .post(`/api/incidents/${shadow1Id}/cancel`)
        .send({ pin: '1234' });
      expect(cancelShadow1.status).toBe(200);
      expect(cancelShadow1.body.incident.status).toBe('CANCELLED');

      // Verify real duress incident is STILL ACTIVE on the server!
      const checkAfterShadowCancel = await responderAgent.get(
        `/api/responder/incidents/${realIncidentId}`
      );
      expect(checkAfterShadowCancel.body.incident.status).toBe('ACTIVE');
      expect(checkAfterShadowCancel.body.incident.is_duress).toBe(true);

      // 3. Owner re-triggers SOS again (Shadow alert #2), lets cancel window expire, and taps "I'm safe" (resolve)
      const shadow2Res = await ownerAgent.post('/api/incidents').send({
        client_request_id: 'req_fix3_shadow_2',
        client_created_at: new Date().toISOString(),
        source_trigger: 'triple_tap',
      });
      const shadow2Id = shadow2Res.body.incident.id;

      await new Promise((r) => setTimeout(r, 1300));

      // Verify NO second set of notifications was sent by the shadow alert!
      const outboxAfterShadow = await ownerAgent.get('/api/dev/outbox');
      expect(outboxAfterShadow.body.messages.length).toBe(countBeforeShadow);

      // Owner resolves Shadow alert #2 ("I'm safe")
      const resolveShadow2 = await ownerAgent
        .post(`/api/incidents/${shadow2Id}/resolve`)
        .send({ resolution: 'RESOLVED' });
      expect(resolveShadow2.status).toBe(200);
      expect(resolveShadow2.body.incident.status).toBe('RESOLVED');

      // Verify real duress incident is STILL ACTIVE and untouched on the server!
      const checkAfterShadowResolve = await responderAgent.get(
        `/api/responder/incidents/${realIncidentId}`
      );
      expect(checkAfterShadowResolve.body.incident.status).toBe('ACTIVE');
      expect(checkAfterShadowResolve.body.incident.is_duress).toBe(true);
      expect(checkAfterShadowResolve.body.incident.closed_at).toBeNull();
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
});
