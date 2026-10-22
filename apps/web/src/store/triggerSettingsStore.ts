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
  /**
   * Salted PBKDF2-SHA256 hash ("pbkdf2$<iterations>$<saltHex>$<digestHex>$<seqLen>")
   * of the user's lowercase voice codeword (minimum 6 characters, 200,000 iterations).
   * There is NO default voice codeword, and the plain codeword is NEVER stored in localStorage.
   */
  voiceCodewordHash: string | null;
  voiceConsentGranted: boolean;

  disguiseEnabled: boolean;
  disguiseUnlockedSession: boolean;
  /**
   * Salted PBKDF2-SHA256 hash ("pbkdf2$<iterations>$<saltHex>$<digestHex>$<seqLen>")
   * of the user's disguise unlock sequence (minimum 200,000 iterations).
   * There is NO default secret sequence, and the plain sequence is NEVER stored in localStorage.
   */
  disguiseSequenceHash: string | null;

  lowPowerDataSaverMode: boolean;
  fakeCallCallerName: string;
  fakeCallDelaySeconds: number;
  setTripleTapEnabled: (enabled: boolean) => void;
  setTripleTapZone: (zone: TapZoneArea) => void;
  setShortcutEnabled: (enabled: boolean) => void;
  setShortcutCombo: (combo: string) => void;
  setShakeEnabled: (enabled: boolean) => void;
  setShakeThreshold: (threshold: number) => void;
  setShakePermissionState: (state: 'prompt' | 'granted' | 'denied') => void;
  setVoiceEnabled: (enabled: boolean) => void;
  setVoiceCodewordHash: (hash: string | null) => void;
  configureVoiceCodeword: (plainCodeword: string) => Promise<string>;
  setVoiceConsentGranted: (granted: boolean) => void;
  setDisguiseEnabled: (enabled: boolean) => void;
  setDisguiseUnlockedSession: (unlocked: boolean) => void;
  setDisguiseSequenceHash: (hash: string | null) => void;
  configureDisguiseSequence: (plainSequence: string) => Promise<string>;
  setLowPowerDataSaverMode: (enabled: boolean) => void;
  setFakeCallCallerName: (name: string) => void;
  setFakeCallDelaySeconds: (seconds: number) => void;
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
  voiceCodewordHash: string | null;
  voiceConsentGranted: boolean;
  disguiseEnabled: boolean;
  disguiseSequenceHash: string | null;
  lowPowerDataSaverMode: boolean;
  fakeCallCallerName: string;
  fakeCallDelaySeconds: number;
}

const DEFAULT_PERSISTED: PersistedSlice = {
  tripleTapEnabled: true,
  tripleTapZone: 'logo',
  shortcutEnabled: true,
  shortcutCombo: 'Shift+Escape',
  shakeEnabled: false,
  shakeThreshold: 25,
  voiceEnabled: false,
  voiceCodewordHash: null, // NO default voice code word!
  voiceConsentGranted: false,
  disguiseEnabled: false,
  disguiseSequenceHash: null, // NO default secret sequence!
  lowPowerDataSaverMode: false,
  fakeCallCallerName: 'Mum',
  fakeCallDelaySeconds: 10,
};

export const DISGUISE_PBKDF2_ITERATIONS = 200000;
export const DISGUISE_MIN_SEQUENCE_LENGTH = 6;
export const VOICE_MIN_CODEWORD_LENGTH = 6;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function computePbkdf2Hex(
  input: string,
  saltBytes: Uint8Array,
  iterations: number = DISGUISE_PBKDF2_ITERATIONS
): Promise<string> {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    globalThis.crypto.subtle &&
    typeof globalThis.crypto.subtle.importKey === 'function' &&
    typeof globalThis.crypto.subtle.deriveBits === 'function'
  ) {
    const encoded = new TextEncoder().encode(input);
    const keyMaterial = await globalThis.crypto.subtle.importKey(
      'raw',
      encoded as unknown as BufferSource,
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    const derivedBits = await globalThis.crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltBytes as unknown as BufferSource,
        iterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      256
    );
    return bytesToHex(new Uint8Array(derivedBits));
  }
  throw new Error('WebCrypto PBKDF2 is required to hash the disguise sequence.');
}

export async function hashDisguiseSequence(
  plainSequence: string,
  iterations: number = DISGUISE_PBKDF2_ITERATIONS
): Promise<string> {
  const normalized = plainSequence.trim();
  if (normalized.length < DISGUISE_MIN_SEQUENCE_LENGTH) {
    throw new Error(
      `Disguise sequence must be at least ${DISGUISE_MIN_SEQUENCE_LENGTH} characters.`
    );
  }
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
  const safeIterations = Math.max(DISGUISE_PBKDF2_ITERATIONS, iterations);
  const digestHex = await computePbkdf2Hex(
    normalized,
    saltBytes,
    safeIterations
  );
  return `pbkdf2$${safeIterations}$${saltHex}$${digestHex}$${normalized.length}`;
}

export async function verifyDisguiseSequenceCandidate(
  candidateBuffer: string,
  storedHash: string | null
): Promise<boolean> {
  if (!storedHash || !candidateBuffer) return false;
  const parts = storedHash.split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2') return false;

  const iterations = parseInt(parts[1], 10);
  const saltHex = parts[2];
  const expectedDigest = parts[3];
  const seqLen = parseInt(parts[4], 10);
  if (
    Number.isNaN(iterations) ||
    iterations < DISGUISE_PBKDF2_ITERATIONS ||
    !saltHex ||
    !expectedDigest ||
    Number.isNaN(seqLen) ||
    seqLen < DISGUISE_MIN_SEQUENCE_LENGTH
  ) {
    return false;
  }
  if (candidateBuffer.length < seqLen) {
    return false;
  }

  const tail = candidateBuffer.slice(-seqLen);
  const saltBytes = hexToBytes(saltHex);
  const actualDigest = await computePbkdf2Hex(tail, saltBytes, iterations);
  return actualDigest === expectedDigest;
}

export async function hashVoiceCodeword(
  plainCodeword: string,
  iterations: number = DISGUISE_PBKDF2_ITERATIONS
): Promise<string> {
  const normalized = plainCodeword.trim().toLowerCase().replace(/\s+/g, ' ');
  if (normalized.length < VOICE_MIN_CODEWORD_LENGTH) {
    throw new Error(
      `Voice codeword must be at least ${VOICE_MIN_CODEWORD_LENGTH} characters.`
    );
  }
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
  const safeIterations = Math.max(DISGUISE_PBKDF2_ITERATIONS, iterations);
  const digestHex = await computePbkdf2Hex(
    normalized,
    saltBytes,
    safeIterations
  );
  return `pbkdf2$${safeIterations}$${saltHex}$${digestHex}$${normalized.length}`;
}

export async function verifyVoiceCodewordTranscript(
  transcript: string,
  storedHash: string | null
): Promise<boolean> {
  if (!storedHash || !transcript) return false;
  const parts = storedHash.split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2') return false;

  const iterations = parseInt(parts[1], 10);
  const saltHex = parts[2];
  const expectedDigest = parts[3];
  const seqLen = parseInt(parts[4], 10);
  if (
    Number.isNaN(iterations) ||
    iterations < DISGUISE_PBKDF2_ITERATIONS ||
    !saltHex ||
    !expectedDigest ||
    Number.isNaN(seqLen) ||
    seqLen < VOICE_MIN_CODEWORD_LENGTH
  ) {
    return false;
  }

  const normalizedTranscript = transcript
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (normalizedTranscript.length < seqLen) {
    return false;
  }

  const saltBytes = hexToBytes(saltHex);

  // Check exact match first
  if (normalizedTranscript.length === seqLen) {
    const digest = await computePbkdf2Hex(
      normalizedTranscript,
      saltBytes,
      iterations
    );
    return digest === expectedDigest;
  }

  // Check word-aligned substrings of length seqLen inside the transcript
  const words = normalizedTranscript.split(' ');
  for (let start = 0; start < words.length; start++) {
    let phrase = '';
    for (let end = start; end < words.length; end++) {
      phrase = phrase ? `${phrase} ${words[end]}` : words[end];
      if (phrase.length === seqLen) {
        const digest = await computePbkdf2Hex(phrase, saltBytes, iterations);
        if (digest === expectedDigest) {
          return true;
        }
      } else if (phrase.length > seqLen) {
        break;
      }
    }
  }

  return false;
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
      voiceCodewordHash: state.voiceCodewordHash,
      voiceConsentGranted: state.voiceConsentGranted,
      disguiseEnabled: state.disguiseEnabled,
      disguiseSequenceHash: state.disguiseSequenceHash,
      lowPowerDataSaverMode: state.lowPowerDataSaverMode,
      fakeCallCallerName: state.fakeCallCallerName,
      fakeCallDelaySeconds: state.fakeCallDelaySeconds,
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
    // Cannot enable voice trigger unless a salted codeword hash has been configured
    if (voiceEnabled && !get().voiceCodewordHash) {
      return;
    }
    set({ voiceEnabled });
    savePersistedSettings(get());
  },
  setVoiceCodewordHash: (voiceCodewordHash) => {
    set({
      voiceCodewordHash,
      ...(voiceCodewordHash === null ? { voiceEnabled: false } : {}),
    });
    savePersistedSettings(get());
  },
  configureVoiceCodeword: async (plainCodeword: string) => {
    const hash = await hashVoiceCodeword(plainCodeword);
    set({
      voiceCodewordHash: hash,
      voiceEnabled: true,
    });
    savePersistedSettings(get());
    return hash;
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
  setFakeCallCallerName: (name: string) => {
    const trimmed = name.trim().slice(0, 30);
    const valid = trimmed.length > 0 ? trimmed : 'Mum';
    set({ fakeCallCallerName: valid });
    savePersistedSettings(get());
  },
  setFakeCallDelaySeconds: (seconds: number) => {
    const valid = [0, 10, 30, 60].includes(seconds) ? seconds : 10;
    set({ fakeCallDelaySeconds: valid });
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
