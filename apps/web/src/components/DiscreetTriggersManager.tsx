import React, { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useTriggerSettingsStore } from '../store/triggerSettingsStore';
import { getPracticeModeTarget, triggerSos } from '../lib/sos';

const DISGUISE_TITLE = 'Calculator';
const DEFAULT_TITLE = 'SAATHI — Safety Assistance & Alert Technology';
const DISGUISE_ICON_DATA_URI =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%231e293b'/%3E%3Crect x='14' y='12' width='36' height='12' rx='4' fill='%230f172a'/%3E%3Ccircle cx='20' cy='34' r='4' fill='%2394a3b8'/%3E%3Ccircle cx='32' cy='34' r='4' fill='%2394a3b8'/%3E%3Ccircle cx='44' cy='34' r='4' fill='%23f59e0b'/%3E%3Ccircle cx='20' cy='46' r='4' fill='%2394a3b8'/%3E%3Ccircle cx='32' cy='46' r='4' fill='%2394a3b8'/%3E%3Ccircle cx='44' cy='46' r='4' fill='%2314b8a6'/%3E%3C/svg%3E";
const DEFAULT_ICON_HREF = '/icon.svg';

export function matchesKeyboardShortcut(
  event: KeyboardEvent,
  combo: string
): boolean {
  if (!combo || !combo.trim()) return false;
  const parts = combo
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return false;

  const needShift = parts.includes('shift');
  const needCtrl = parts.includes('ctrl') || parts.includes('control');
  const needAlt = parts.includes('alt') || parts.includes('option');
  const needMeta = parts.includes('meta') || parts.includes('cmd');

  const mainKey = parts.find(
    (p) =>
      p !== 'shift' &&
      p !== 'ctrl' &&
      p !== 'control' &&
      p !== 'alt' &&
      p !== 'option' &&
      p !== 'meta' &&
      p !== 'cmd'
  );

  if (!mainKey) return false;

  if (Boolean(event.shiftKey) !== needShift) return false;
  if (Boolean(event.ctrlKey) !== needCtrl) return false;
  if (Boolean(event.altKey) !== needAlt) return false;
  if (Boolean(event.metaKey) !== needMeta) return false;

  const eventKey = (event.key || '').toLowerCase();
  const normalizedMain = mainKey === 'esc' ? 'escape' : mainKey;
  const normalizedEventKey = eventKey === 'esc' ? 'escape' : eventKey;

  return normalizedEventKey === normalizedMain;
}

export function isDeviceMotionSupported(): boolean {
  return typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
}

export function getSpeechRecognitionConstructor(): any | null {
  if (typeof window === 'undefined') return null;
  const win = window as any;
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

export const DiscreetTriggersManager: React.FC = () => {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const {
    shortcutEnabled,
    shortcutCombo,
    shakeEnabled,
    shakeThreshold,
    voiceEnabled,
    voiceCodeword,
    voiceConsentGranted,
    disguiseEnabled,
    disguiseUnlockedSession,
  } = useTriggerSettingsStore();

  const lastTriggerAtRef = useRef<number>(0);

  const fireDiscreetSos = (source: string) => {
    const now = Date.now();
    // Prevent rapid duplicate firing within 1.5s unless in practice mode
    if (getPracticeModeTarget() === null && now - lastTriggerAtRef.current < 1500) {
      return;
    }
    lastTriggerAtRef.current = now;

    const isPractice = getPracticeModeTarget() !== null;
    void triggerSos(source).then(() => {
      if (!isPractice && location.pathname !== '/home') {
        navigate('/home');
      }
    });
  };

  // 1. Disguise Mode: update document.title and favicon while disguised
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const isCurrentlyDisguised =
      Boolean(user) && disguiseEnabled && !disguiseUnlockedSession;

    document.title = isCurrentlyDisguised ? DISGUISE_TITLE : DEFAULT_TITLE;

    let iconLink = document.querySelector(
      'link[rel="icon"]'
    ) as HTMLLinkElement | null;
    if (!iconLink) {
      iconLink = document.createElement('link');
      iconLink.rel = 'icon';
      document.head.appendChild(iconLink);
    }
    iconLink.href = isCurrentlyDisguised
      ? DISGUISE_ICON_DATA_URI
      : DEFAULT_ICON_HREF;
  }, [user, disguiseEnabled, disguiseUnlockedSession]);

  // 2. Keyboard Shortcut Trigger (Desktop)
  useEffect(() => {
    if (!user || !shortcutEnabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if typing inside an input/textarea that is recording a new shortcut
      const target = event.target as HTMLElement | null;
      if (
        target &&
        typeof target.getAttribute === 'function' &&
        target.getAttribute('data-shortcut-recorder') === 'true'
      ) {
        return;
      }

      if (matchesKeyboardShortcut(event, shortcutCombo)) {
        event.preventDefault();
        fireDiscreetSos('keyboard_shortcut');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [user, shortcutEnabled, shortcutCombo, location.pathname]);

  // 3. Shake Detection Trigger (DeviceMotion API)
  useEffect(() => {
    if (!user || !shakeEnabled || !isDeviceMotionSupported()) {
      return;
    }

    const handleDeviceMotion = (event: Event) => {
      const motionEvent = event as any;
      const acc =
        motionEvent.accelerationIncludingGravity || motionEvent.acceleration;
      if (!acc) return;

      const x = Number(acc.x || 0);
      const y = Number(acc.y || 0);
      const z = Number(acc.z || 0);
      const magnitude = Math.sqrt(x * x + y * y + z * z);

      if (magnitude >= shakeThreshold) {
        fireDiscreetSos('shake');
      }
    };

    window.addEventListener('devicemotion', handleDeviceMotion);
    return () => {
      window.removeEventListener('devicemotion', handleDeviceMotion);
    };
  }, [user, shakeEnabled, shakeThreshold, location.pathname]);

  // 4. Voice Code Word Trigger (Experimental Web Speech API, requires explicit consent)
  useEffect(() => {
    if (!user || !voiceEnabled || !voiceConsentGranted) {
      return;
    }

    const SpeechRecognitionCtor = getSpeechRecognitionConstructor();
    if (!SpeechRecognitionCtor) {
      return;
    }

    let recognition: any = null;
    let stopped = false;

    try {
      recognition = new SpeechRecognitionCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = user.language === 'hi' ? 'hi-IN' : 'en-IN';

      recognition.onresult = (event: any) => {
        if (stopped) return;
        const targetWord = (voiceCodeword || '').trim().toLowerCase();
        if (!targetWord) return;

        const results = event?.results;
        if (!results) return;

        for (let i = event.resultIndex || 0; i < results.length; i++) {
          const item = results[i];
          const transcript = String(item?.[0]?.transcript || '')
            .trim()
            .toLowerCase();
          if (transcript && transcript.includes(targetWord)) {
            fireDiscreetSos('voice');
            break;
          }
        }
      };

      recognition.onerror = () => {
        // ignore speech recognition errors silently
      };

      if (typeof recognition.start === 'function') {
        recognition.start();
      }
    } catch {
      // Do nothing if unsupported or blocked
    }

    return () => {
      stopped = true;
      if (recognition && typeof recognition.stop === 'function') {
        try {
          recognition.stop();
        } catch {
          // ignore
        }
      }
    };
  }, [
    user,
    voiceEnabled,
    voiceConsentGranted,
    voiceCodeword,
    location.pathname,
  ]);

  return null;
};
