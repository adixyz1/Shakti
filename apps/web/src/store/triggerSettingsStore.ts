import { create } from 'zustand';

export type TapZoneArea = 'logo' | 'footer';

export interface TriggerSettingsState {
  tripleTapEnabled: boolean;
  tripleTapZone: TapZoneArea;

  shortcutEnabled: boolean;
  shortcutCombo: string;

  shakeEnabled: boolean;
  shakeThreshold: number;
  shakePermissionState: 'prompt' | 'granted' | 'denied';

  voiceEnabled: boolean;
  voiceCodeword: string;
  voiceConsentGranted: boolean;

  disguiseEnabled: boolean;
  disguiseUnlockedSession: boolean;
  /**
   * Salted SHA-256 hash ("sha256$<saltHex>$<digestHex>$<seqLen>") of the user's
   * disguise unlock sequence. There is NO default secret sequence, and the plain
   * sequence is NEVER stored in localStorage.
   */
  disguiseSequenceHash: string | null;

  lowPowerDataSaverMode: boolean;

  setTripleTapEnabled: (enabled: boolean) => void;
  setTripleTapZone: (zone: TapZoneArea) => void;
  setShortcutEnabled: (enabled: boolean) => void;
  setShortcutCombo: (combo: string) => void;
  setShakeEnabled: (enabled: boolean) => void;
  setShakeThreshold: (threshold: number) => void;
  setShakePermissionState: (state: 'prompt' | 'granted' | 'denied') => void;
  setVoiceEnabled: (enabled: boolean) => void;
  setVoiceCodeword: (codeword: string) => void;
  setVoiceConsentGranted: (granted: boolean) => void;
  setDisguiseEnabled: (enabled: boolean) => void;
  setDisguiseUnlockedSession: (unlocked: boolean) => void;
  setDisguiseSequenceHash: (hash: string | null) => void;
  configureDisguiseSequence: (plainSequence: string) => Promise<string>;
  setLowPowerDataSaverMode: (enabled: boolean) => void;
  resetTriggerSettings: () => void;
}

const STORAGE_KEY = 'saathi_trigger_settings_v1';

interface PersistedSlice {
  tripleTapEnabled: boolean;
  tripleTapZone: TapZoneArea;
  shortcutEnabled: boolean;
  shortcutCombo: string;
  shakeEnabled: boolean;
  shakeThreshold: number;
  voiceEnabled: boolean;
  voiceCodeword: string;
  voiceConsentGranted: boolean;
  disguiseEnabled: boolean;
  disguiseSequenceHash: string | null;
  lowPowerDataSaverMode: boolean;
}

const DEFAULT_PERSISTED: PersistedSlice = {
  tripleTapEnabled: true,
  tripleTapZone: 'logo',
  shortcutEnabled: true,
  shortcutCombo: 'Shift+Escape',
  shakeEnabled: false,
  shakeThreshold: 25,
  voiceEnabled: false,
  voiceCodeword: 'saathi help',
  voiceConsentGranted: false,
  disguiseEnabled: false,
  disguiseSequenceHash: null, // NO default secret sequence!
  lowPowerDataSaverMode: false,
};

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function computeSha256Hex(input: string): Promise<string> {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    globalThis.crypto.subtle &&
    typeof globalThis.crypto.subtle.digest === 'function'
  ) {
    const encoded = new TextEncoder().encode(input);
    const buf = await globalThis.crypto.subtle.digest('SHA-256', encoded);
    return bytesToHex(new Uint8Array(buf));
  }
  // Fallback for environments without Web Crypto subtle
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0, ch; i < input.length; i++) {
    ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (
    (h1 >>> 0).toString(16).padStart(8, '0') +
    (h2 >>> 0).toString(16).padStart(8, '0')
  );
}

export async function hashDisguiseSequence(
  plainSequence: string
): Promise<string> {
  const normalized = plainSequence.trim();
  const saltBytes = new Uint8Array(16);
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.getRandomValues === 'function'
  ) {
    globalThis.crypto.getRandomValues(saltBytes);
  } else {
    for (let i = 0; i < 16; i++) {
      saltBytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const saltHex = bytesToHex(saltBytes);
  const digestHex = await computeSha256Hex(`${saltHex}:${normalized}`);
  return `sha256$${saltHex}$${digestHex}$${normalized.length}`;
}

export async function verifyDisguiseSequenceCandidate(
  candidateBuffer: string,
  storedHash: string | null
): Promise<boolean> {
  if (!storedHash || !candidateBuffer) return false;
  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== 'sha256') return false;

  const saltHex = parts[1];
  const expectedDigest = parts[2];
  const seqLen = parseInt(parts[3], 10);
  if (!saltHex || !expectedDigest || Number.isNaN(seqLen) || seqLen <= 0) {
    return false;
  }
  if (candidateBuffer.length < seqLen) {
    return false;
  }

  const tail = candidateBuffer.slice(-seqLen);
  const actualDigest = await computeSha256Hex(`${saltHex}:${tail}`);
  return actualDigest === expectedDigest;
}

function loadInitialSettings(): PersistedSlice {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_PERSISTED };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PERSISTED };
    const parsed = JSON.parse(raw) as Partial<PersistedSlice>;
    return {
      ...DEFAULT_PERSISTED,
      ...parsed,
    };
  } catch {
    return { ...DEFAULT_PERSISTED };
  }
}

function savePersistedSettings(state: TriggerSettingsState): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: PersistedSlice = {
      tripleTapEnabled: state.tripleTapEnabled,
      tripleTapZone: state.tripleTapZone,
      shortcutEnabled: state.shortcutEnabled,
      shortcutCombo: state.shortcutCombo,
      shakeEnabled: state.shakeEnabled,
      shakeThreshold: state.shakeThreshold,
      voiceEnabled: state.voiceEnabled,
      voiceCodeword: state.voiceCodeword,
      voiceConsentGranted: state.voiceConsentGranted,
      disguiseEnabled: state.disguiseEnabled,
      disguiseSequenceHash: state.disguiseSequenceHash,
      lowPowerDataSaverMode: state.lowPowerDataSaverMode,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

const initial = loadInitialSettings();

export const useTriggerSettingsStore = create<TriggerSettingsState>((set, get) => ({
  ...initial,
  shakePermissionState: 'prompt',
  disguiseUnlockedSession: false,

  setTripleTapEnabled: (tripleTapEnabled) => {
    set({ tripleTapEnabled });
    savePersistedSettings(get());
  },
  setTripleTapZone: (tripleTapZone) => {
    set({ tripleTapZone });
    savePersistedSettings(get());
  },
  setShortcutEnabled: (shortcutEnabled) => {
    set({ shortcutEnabled });
    savePersistedSettings(get());
  },
  setShortcutCombo: (shortcutCombo) => {
    set({ shortcutCombo });
    savePersistedSettings(get());
  },
  setShakeEnabled: (shakeEnabled) => {
    set({ shakeEnabled });
    savePersistedSettings(get());
  },
  setShakeThreshold: (shakeThreshold) => {
    set({ shakeThreshold });
    savePersistedSettings(get());
  },
  setShakePermissionState: (shakePermissionState) => {
    set({ shakePermissionState });
  },
  setVoiceEnabled: (voiceEnabled) => {
    set({ voiceEnabled });
    savePersistedSettings(get());
  },
  setVoiceCodeword: (voiceCodeword) => {
    set({ voiceCodeword });
    savePersistedSettings(get());
  },
  setVoiceConsentGranted: (voiceConsentGranted) => {
    set({ voiceConsentGranted });
    savePersistedSettings(get());
  },
  setDisguiseEnabled: (disguiseEnabled) => {
    // Cannot enable disguise mode unless a salted sequence hash has been configured
    if (disguiseEnabled && !get().disguiseSequenceHash) {
      return;
    }
    set({
      disguiseEnabled,
      disguiseUnlockedSession: false,
    });
    savePersistedSettings(get());
  },
  setDisguiseUnlockedSession: (disguiseUnlockedSession) => {
    set({ disguiseUnlockedSession });
  },
  setDisguiseSequenceHash: (disguiseSequenceHash) => {
    set({
      disguiseSequenceHash,
      ...(disguiseSequenceHash === null ? { disguiseEnabled: false } : {}),
    });
    savePersistedSettings(get());
  },
  configureDisguiseSequence: async (plainSequence: string) => {
    const hash = await hashDisguiseSequence(plainSequence);
    set({
      disguiseSequenceHash: hash,
      disguiseEnabled: true,
      disguiseUnlockedSession: false,
    });
    savePersistedSettings(get());
    return hash;
  },
  setLowPowerDataSaverMode: (lowPowerDataSaverMode) => {
    set({ lowPowerDataSaverMode });
    savePersistedSettings(get());
  },
  resetTriggerSettings: () => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    }
    set({
      ...DEFAULT_PERSISTED,
      shakePermissionState: 'prompt',
      disguiseUnlockedSession: false,
    });
  },
}));
