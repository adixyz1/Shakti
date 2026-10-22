import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../i18n';
import { HomePage } from '../pages/HomePage';
import { SettingsPage } from '../pages/SettingsPage';
import { FakeCallModal } from '../components/FakeCallModal';
import { LoudAlarmModal } from '../components/LoudAlarmModal';
import { useAuthStore } from '../store/authStore';
import { useTriggerSettingsStore } from '../store/triggerSettingsStore';
import * as apiModule from '../lib/api';
import * as sosModule from '../lib/sos';

const mockUser: any = {
  id: 'usr_test_10a',
  phone_e164: '+919000000001',
  name: 'Aarohi Sharma',
  role: 'user',
  language: 'en',
  created_at: new Date().toISOString(),
  cancel_window_seconds: 5,
  has_cancel_pin: false,
  has_duress_pin: false,
};

describe('Phase 10A: Secondary Safety Tools (Fake Call & Loud Alarm)', () => {
  let mockWakeLockSentinel: any;
  let mockAudioContext: any;
  let triggerSosSpy: any;
  let triggerApiSpy: any;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    void i18n.changeLanguage('en');

    // Reset stores
    useAuthStore.getState().setUser(mockUser);
    useTriggerSettingsStore.getState().resetTriggerSettings();

    // Mock AudioContext
    mockAudioContext = {
      state: 'running',
      currentTime: 0,
      destination: {},
      createOscillator: vi.fn(() => ({
        type: 'sine',
        frequency: {
          setValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      })),
      createGain: vi.fn(() => ({
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    (window as any).AudioContext = vi.fn().mockImplementation(function () {
      return mockAudioContext;
    });

    // Mock Wake Lock API
    mockWakeLockSentinel = {
      released: false,
      release: vi.fn().mockResolvedValue(undefined),
    };
    Object.defineProperty(navigator, 'wakeLock', {
      value: {
        request: vi.fn().mockResolvedValue(mockWakeLockSentinel),
      },
      writable: true,
      configurable: true,
    });

    // Mock navigator.vibrate
    navigator.vibrate = vi.fn();

    // Mock matchMedia for prefers-reduced-motion
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    // Mock API calls so HomePage loads cleanly without active incident
    vi.spyOn(apiModule.incidentsApi, 'getActiveIncident').mockResolvedValue({
      incident: null,
    } as any);
    vi.spyOn(apiModule.contactsApi, 'listContacts').mockResolvedValue({ contacts: [] });
    vi.spyOn(apiModule.consentsApi, 'getConsents').mockResolvedValue({} as any);

    // Assert NO incident is created: spy on triggerSos and incidentsApi.createIncident
    triggerSosSpy = vi.spyOn(sosModule, 'triggerSos');
    triggerApiSpy = vi.spyOn(apiModule.incidentsApi, 'createIncident');
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // 1. Settings validation
  it('1. Settings validation: caller name max 30 chars, delay options (0, 10, 30, 60s), and honest background limit note', async () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );

    // Initial state: default caller name "Mum", delay 10s
    const nameInput = screen.getByTestId('fake-call-caller-name-input') as HTMLInputElement;
    expect(nameInput.value).toBe('Mum');

    // Limit note is displayed
    const limitNote = screen.getByTestId('fake-call-limit-note');
    expect(limitNote.textContent).toContain(
      'The timer pauses if the phone locks or the app goes to the background.'
    );

    // Select different delay presets
    const delay30Btn = screen.getByTestId('fake-call-delay-btn-30');
    fireEvent.click(delay30Btn);
    expect(useTriggerSettingsStore.getState().fakeCallDelaySeconds).toBe(30);

    const delayNowBtn = screen.getByTestId('fake-call-delay-btn-0');
    fireEvent.click(delayNowBtn);
    expect(useTriggerSettingsStore.getState().fakeCallDelaySeconds).toBe(0);

    // Caller name input with validation (max 30 chars)
    fireEvent.change(nameInput, { target: { value: 'Brother Rahul' } });
    expect(useTriggerSettingsStore.getState().fakeCallCallerName).toBe('Brother Rahul');

    // Excess length gets sliced to 30 chars
    const overlyLongName = 'A'.repeat(50);
    fireEvent.change(nameInput, { target: { value: overlyLongName } });
    expect(useTriggerSettingsStore.getState().fakeCallCallerName.length).toBe(30);

    // Empty name defaults to "Mum"
    fireEvent.change(nameInput, { target: { value: '   ' } });
    expect(useTriggerSettingsStore.getState().fakeCallCallerName).toBe('Mum');
  });

  // 2. Countdown fires
  it('2. Countdown fires: delay=10s displays countdown and fires ringing; delay=0s rings immediately', async () => {
    useTriggerSettingsStore.getState().setFakeCallCallerName('Police Station');
    useTriggerSettingsStore.getState().setFakeCallDelaySeconds(10);

    const { rerender } = render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    // Wait for HomePage to load
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const fakeCallBtn = screen.getByTestId('home-fake-call-btn');
    expect(fakeCallBtn).toBeInTheDocument();

    // Click Fake call on Home
    fireEvent.click(fakeCallBtn);

    // AudioContext was created upon gesture
    expect((window as any).AudioContext).toHaveBeenCalled();

    // Countdown modal is rendered with caller name and remaining seconds
    expect(screen.getByTestId('fake-call-countdown-modal')).toBeInTheDocument();
    expect(screen.getByText(/Police Station/)).toBeInTheDocument();
    expect(screen.getByText('10s')).toBeInTheDocument();

    // Advance 5 seconds
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText('5s')).toBeInTheDocument();

    // Advance 5 more seconds -> countdown reaches 0 and fires ringing
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByTestId('fake-call-countdown-modal')).not.toBeInTheDocument();
    expect(screen.getByTestId('fake-call-ringing-screen')).toBeInTheDocument();
    expect(screen.getByTestId('fake-call-caller-name').textContent).toBe('Police Station');
    expect(navigator.vibrate).toHaveBeenCalled();

    // Now test delay=0 (Now) -> immediately rings without countdown
    const onClose = vi.fn();
    rerender(
      <FakeCallModal
        isOpen={true}
        onClose={onClose}
        audioContext={mockAudioContext}
      />
    );
    act(() => {
      useTriggerSettingsStore.getState().setFakeCallDelaySeconds(0);
    });

    rerender(
      <FakeCallModal
        isOpen={true}
        onClose={onClose}
        audioContext={mockAudioContext}
      />
    );

    expect(screen.queryByTestId('fake-call-countdown-modal')).not.toBeInTheDocument();
    expect(screen.getByTestId('fake-call-ringing-screen')).toBeInTheDocument();
  });

  // 3. Accept/decline/end flow
  it('3. Accept/decline/end flow: decline closes; accept shows running timer and End button; does not show product name', () => {
    useTriggerSettingsStore.getState().setFakeCallCallerName('Dr. Sharma');
    useTriggerSettingsStore.getState().setFakeCallDelaySeconds(0);
    const onClose = vi.fn();

    const { rerender } = render(
      <FakeCallModal
        isOpen={true}
        onClose={onClose}
        audioContext={mockAudioContext}
      />
    );

    const ringingScreen = screen.getByTestId('fake-call-ringing-screen');
    expect(ringingScreen).toBeInTheDocument();

    // Product name MUST NOT appear on the realistic call screen
    expect(ringingScreen.textContent).not.toContain('SHAKTI');
    expect(ringingScreen.textContent).not.toContain('SAATHI');

    // Decline button flow
    const declineBtn = screen.getByTestId('fake-call-decline-btn');
    fireEvent.click(declineBtn);
    expect(onClose).toHaveBeenCalledTimes(1);

    // Reopen and test Accept flow
    rerender(
      <FakeCallModal
        isOpen={true}
        onClose={onClose}
        audioContext={mockAudioContext}
      />
    );

    const acceptBtn = screen.getByTestId('fake-call-accept-btn');
    fireEvent.click(acceptBtn);

    // Vibrations silenced on accept
    expect(navigator.vibrate).toHaveBeenCalledWith(0);

    // Call active screen rendered with running timer
    const activeScreen = screen.getByTestId('fake-call-active-screen');
    expect(activeScreen).toBeInTheDocument();
    expect(screen.getByTestId('fake-call-active-caller').textContent).toBe('Dr. Sharma');
    expect(screen.getByTestId('fake-call-timer').textContent).toBe('00:00');

    // Also no product name on active call screen
    expect(activeScreen.textContent).not.toContain('SHAKTI');
    expect(activeScreen.textContent).not.toContain('SAATHI');

    // Timer advances
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByTestId('fake-call-timer').textContent).toBe('00:03');

    // End call button closes
    const endBtn = screen.getByTestId('fake-call-end-btn');
    fireEvent.click(endBtn);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  // 4. Loud Alarm start, stop, and 5-minute auto-stop
  it('4. Loud alarm: honest warning note, start/stop flow, and auto-stop after 5 minutes (300s)', async () => {
    const onClose = vi.fn();
    render(<LoudAlarmModal isOpen={true} onClose={onClose} />);

    // Start screen shows honest note
    const honestNote = screen.getByTestId('loud-alarm-honest-note');
    expect(honestNote.textContent).toContain(
      'This makes a loud sound to attract attention. It does not alert anyone.'
    );

    const startBtn = screen.getByTestId('loud-alarm-start-btn');
    await act(async () => {
      fireEvent.click(startBtn);
    });

    // Sounding screen is visible
    expect(screen.getByTestId('loud-alarm-sounding-screen')).toBeInTheDocument();
    expect(screen.getByTestId('loud-alarm-stop-btn')).toBeInTheDocument();

    // Auto-stop after 300 seconds (5 minutes)
    act(() => {
      vi.advanceTimersByTime(300000);
    });

    // Reset back to idle start screen
    expect(screen.queryByTestId('loud-alarm-sounding-screen')).not.toBeInTheDocument();
    expect(screen.getByTestId('loud-alarm-idle-modal')).toBeInTheDocument();

    // Restart and test manual stop
    await act(async () => {
      fireEvent.click(screen.getByTestId('loud-alarm-start-btn'));
    });
    expect(screen.getByTestId('loud-alarm-sounding-screen')).toBeInTheDocument();

    const stopBtn = screen.getByTestId('loud-alarm-stop-btn');
    fireEvent.click(stopBtn);

    expect(screen.queryByTestId('loud-alarm-sounding-screen')).not.toBeInTheDocument();
    expect(screen.getByTestId('loud-alarm-idle-modal')).toBeInTheDocument();
  });

  // 5. Screen Wake Lock requested and released
  it('5. Wake Lock API: screen lock is requested when alarm starts and released when stopped', async () => {
    const onClose = vi.fn();
    render(<LoudAlarmModal isOpen={true} onClose={onClose} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('loud-alarm-start-btn'));
    });

    expect(navigator.wakeLock.request).toHaveBeenCalledWith('screen');
    expect(mockWakeLockSentinel.release).not.toHaveBeenCalled();

    // Stop alarm releases wake lock
    fireEvent.click(screen.getByTestId('loud-alarm-stop-btn'));
    expect(mockWakeLockSentinel.release).toHaveBeenCalled();
  });

  // 6. Reduced-motion path
  it('6. Reduced-motion path: respects prefers-reduced-motion with steady display indicator', async () => {
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    render(<LoudAlarmModal isOpen={true} onClose={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('loud-alarm-start-btn'));
    });

    expect(screen.getByTestId('reduced-motion-indicator')).toBeInTheDocument();
    expect(screen.getByTestId('reduced-motion-indicator').textContent).toContain(
      'Steady display mode active'
    );
  });

  // 7. Hidden during an active alert screen and in disguise mode
  it('7. Hidden or unreachable during active alert screen and in disguise mode', async () => {
    // A. Active alert present
    vi.spyOn(apiModule.incidentsApi, 'getActiveIncident').mockResolvedValue({
      incident: {
        id: 'inc_active_1',
        userId: 'usr_test_10a',
        status: 'NOTIFIED',
        triggerSource: 'sos_button',
        isDuress: false,
        escalationStage: 1,
        needsUserAction: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        locationCount: 0,
      },
    } as any);

    const { unmount } = render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // Secondary safety tools must NOT be rendered during an active alert
    expect(screen.queryByTestId('home-fake-call-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('home-loud-alarm-btn')).not.toBeInTheDocument();

    unmount();

    // B. Disguise mode enabled (and locked)
    vi.spyOn(apiModule.incidentsApi, 'getActiveIncident').mockResolvedValue({
      incident: null,
    } as any);
    useTriggerSettingsStore.getState().setDisguiseSequenceHash('pbkdf2$200000$00$00$6');
    useTriggerSettingsStore.getState().setDisguiseEnabled(true);
    useTriggerSettingsStore.getState().setDisguiseUnlockedSession(false);

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // HomePage renders Calculator disguise and neither tool is visible
    expect(screen.getByTestId('disguise-calculator')).toBeInTheDocument();
    expect(screen.queryByTestId('home-fake-call-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('home-loud-alarm-btn')).not.toBeInTheDocument();
  });

  // 8. Hindi strings
  it('8. Hindi translations: renders all fake call and loud alarm copy in Hindi without missing keys', async () => {
    await act(async () => {
      await i18n.changeLanguage('hi');
    });

    useTriggerSettingsStore.getState().setFakeCallDelaySeconds(10);

    const { rerender } = render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // Buttons rendered in Hindi
    expect(screen.getByTestId('home-fake-call-btn').textContent).toContain('नकली कॉल');
    expect(screen.getByTestId('home-loud-alarm-btn').textContent).toContain('तेज अलार्म');

    // Fake call countdown in Hindi
    fireEvent.click(screen.getByTestId('home-fake-call-btn'));
    expect(screen.getByText('नकली कॉल रद्द करें')).toBeInTheDocument();

    // Loud alarm in Hindi
    rerender(<LoudAlarmModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByTestId('loud-alarm-honest-note').textContent).toContain(
      'यह ध्यान आकर्षित करने के लिए एक तेज आवाज करता है।'
    );
    expect(screen.getByTestId('loud-alarm-start-btn').textContent).toContain('अलार्म शुरू करें');
  });

  // 9. No incident created: assert no POST /api/incidents
  it('9. Deterministic safety: zero incidents created across all fake call and alarm actions', async () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // Interact with fake call
    fireEvent.click(screen.getByTestId('home-fake-call-btn'));
    const cancelBtn = screen.getByTestId('fake-call-cancel-btn');
    fireEvent.click(cancelBtn);

    // Interact with loud alarm
    fireEvent.click(screen.getByTestId('home-loud-alarm-btn'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('loud-alarm-start-btn'));
    });
    fireEvent.click(screen.getByTestId('loud-alarm-stop-btn'));

    // Assert that NO SOS trigger or API incident call occurred
    expect(triggerSosSpy).not.toHaveBeenCalled();
    expect(triggerApiSpy).not.toHaveBeenCalled();
  });
});
