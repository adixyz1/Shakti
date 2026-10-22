/**
 * Web Audio API and Screen Wake Lock helpers for offline safety tools:
 * - Fake incoming call ringtone synthesis (dual-tone cadence + vibration)
 * - Loud alarm sweeping siren synthesis (max audible volume + wake lock)
 */

export function createAudioContext(): AudioContext | null {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return null;
    const ctx = new AudioContextClass();
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    return ctx;
  } catch {
    return null;
  }
}

export interface SoundController {
  stop: () => void;
}

/**
 * Synthesizes a realistic telephone ringtone cadence using dual sine tones (440Hz + 480Hz).
 * Does not use any audio files or copyrighted ringtones.
 * Also pulses device vibration where supported.
 */
export function playRingtone(ctx: AudioContext): SoundController {
  let active = true;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let osc1: OscillatorNode | null = null;
  let osc2: OscillatorNode | null = null;
  let gain: GainNode | null = null;

  const stopCurrentTone = () => {
    try {
      if (osc1) {
        osc1.stop();
        osc1.disconnect();
        osc1 = null;
      }
      if (osc2) {
        osc2.stop();
        osc2.disconnect();
        osc2 = null;
      }
      if (gain) {
        gain.disconnect();
        gain = null;
      }
    } catch {
      // ignore
    }
  };

  const ringCycle = () => {
    if (!active) return;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    try {
      stopCurrentTone();

      osc1 = ctx.createOscillator();
      osc2 = ctx.createOscillator();
      gain = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(440, ctx.currentTime);
      osc2.frequency.setValueAtTime(480, ctx.currentTime);

      // Smooth rise and fall for realistic phone ring
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.6, ctx.currentTime + 0.05);
      gain.gain.setValueAtTime(0.6, ctx.currentTime + 1.8);
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 1.95);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(ctx.currentTime);
      osc2.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + 2.0);
      osc2.stop(ctx.currentTime + 2.0);

      // Trigger vibration cadence [ring, silence, ring, silence]
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate([1000, 1000]);
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore synthesis errors
    }

    // Repeat every 3.5 seconds
    if (active) {
      timerId = setTimeout(ringCycle, 3500);
    }
  };

  ringCycle();

  return {
    stop: () => {
      active = false;
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }
      stopCurrentTone();
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate(0);
        } catch {
          // ignore
        }
      }
    },
  };
}

/**
 * Synthesizes a loud sweeping emergency siren using Web Audio API (600Hz - 1300Hz ramp).
 * Runs at the loudest safe audible volume the page can play.
 */
export function playSiren(ctx: AudioContext): SoundController {
  let active = true;
  let osc: OscillatorNode | null = null;
  let lfo: OscillatorNode | null = null;
  let lfoGain: GainNode | null = null;
  let masterGain: GainNode | null = null;

  try {
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    osc = ctx.createOscillator();
    lfo = ctx.createOscillator();
    lfoGain = ctx.createGain();
    masterGain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(950, ctx.currentTime);

    // LFO sweeps between ~600Hz and ~1300Hz once per second (1 Hz)
    lfo.type = 'triangle';
    lfo.frequency.setValueAtTime(1.0, ctx.currentTime);
    lfoGain.gain.setValueAtTime(350, ctx.currentTime);

    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    // Full audible gain
    masterGain.gain.setValueAtTime(1.0, ctx.currentTime);

    osc.connect(masterGain);
    masterGain.connect(ctx.destination);

    lfo.start();
    osc.start();
  } catch {
    // ignore
  }

  return {
    stop: () => {
      active = false;
      try {
        osc?.stop();
        lfo?.stop();
        osc?.disconnect();
        lfo?.disconnect();
        lfoGain?.disconnect();
        masterGain?.disconnect();
      } catch {
        // ignore
      }
    },
  };
}

/**
 * Requests Screen Wake Lock to prevent the screen from turning off while alarm is sounding.
 */
export async function requestScreenWakeLock(): Promise<{ release: () => Promise<void> } | null> {
  if (
    typeof navigator !== 'undefined' &&
    'wakeLock' in navigator &&
    navigator.wakeLock &&
    typeof navigator.wakeLock.request === 'function'
  ) {
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      return sentinel;
    } catch {
      return null;
    }
  }
  return null;
}
