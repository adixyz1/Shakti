import React, { useEffect, useRef, useState } from 'react';
import { Volume2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  createAudioContext,
  playSiren,
  requestScreenWakeLock,
  type SoundController,
} from '../lib/safetyAudio';

export interface LoudAlarmModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export type AlarmState = 'idle' | 'sounding';

const ALARM_AUTO_STOP_SECONDS = 300; // 5 minutes

export const LoudAlarmModal: React.FC<LoudAlarmModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const [alarmState, setAlarmState] = useState<AlarmState>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [flashActive, setFlashActive] = useState<boolean>(false);

  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  const soundControllerRef = useRef<SoundController | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);

  // Check reduced motion listener
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener('change', onChange);
    return () => mediaQuery.removeEventListener('change', onChange);
  }, []);

  const stopAlarm = () => {
    soundControllerRef.current?.stop();
    soundControllerRef.current = null;
    if (wakeLockRef.current) {
      void wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
    setAlarmState('idle');
    setElapsedSeconds(0);
    setFlashActive(false);
  };

  // Cleanup on close or unmount
  useEffect(() => {
    if (!isOpen) {
      stopAlarm();
    }
    return () => {
      stopAlarm();
    };
  }, [isOpen]);

  // Handle siren auto-stop after 5 minutes & flashing rhythm (1 Hz = once per second)
  useEffect(() => {
    if (!isOpen || alarmState !== 'sounding') return;

    const interval = setInterval(() => {
      setFlashActive((prev) => !prev);
      setElapsedSeconds((prev) => {
        if (prev + 1 >= ALARM_AUTO_STOP_SECONDS) {
          stopAlarm();
          return 0;
        }
        return prev + 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isOpen, alarmState]);

  if (!isOpen) return null;

  const handleStart = async () => {
    // 1. Web Audio context created on explicit user tap
    if (!audioContextRef.current) {
      audioContextRef.current = createAudioContext();
    } else if (audioContextRef.current.state === 'suspended') {
      void audioContextRef.current.resume();
    }

    if (audioContextRef.current) {
      soundControllerRef.current = playSiren(audioContextRef.current);
    }

    // 2. Request Screen Wake Lock
    wakeLockRef.current = await requestScreenWakeLock();

    setAlarmState('sounding');
    setElapsedSeconds(0);
  };

  const handleStop = () => {
    stopAlarm();
  };

  const handleClose = () => {
    stopAlarm();
    onClose();
  };

  const formatRemainingTime = (elapsed: number) => {
    const remaining = Math.max(0, ALARM_AUTO_STOP_SECONDS - elapsed);
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // SOUNDING STATE: Siren active, screen wake lock on
  if (alarmState === 'sounding') {
    const bgClass = prefersReducedMotion
      ? 'bg-crimson-900'
      : flashActive
      ? 'bg-crimson-800'
      : 'bg-crimson-900';

    return (
      <div
        data-testid="loud-alarm-sounding-screen"
        role="dialog"
        aria-modal="true"
        aria-label={t('loudAlarm.soundingTitle')}
        className={`fixed inset-0 z-50 flex flex-col justify-between items-center p-8 text-surface select-none transition-colors duration-500 ${bgClass}`}
      >
        <div className="w-full max-w-sm flex flex-col items-center pt-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-surface/20 border-2 border-surface/40 flex items-center justify-center text-surface">
            <Volume2 className="w-8 h-8 animate-pulse" />
          </div>

          <div className="space-y-1">
            <h1 className="text-2xl md:text-3xl font-mono font-bold tracking-tight text-surface uppercase">
              {t('loudAlarm.soundingTitle')}
            </h1>
            <p className="text-xs font-mono text-surface/90">
              {t('loudAlarm.autoStopNotice', {
                time: formatRemainingTime(elapsedSeconds),
              })}
            </p>
          </div>

          {prefersReducedMotion && (
            <span
              data-testid="reduced-motion-indicator"
              className="text-xs font-mono bg-black/40 px-3 py-1 rounded-xl text-surface border border-line/40"
            >
              {t('loudAlarm.reducedMotionNotice')}
            </span>
          )}
        </div>

        {/* Big clearly labeled STOP button */}
        <div className="w-full max-w-xs pb-12 flex flex-col items-center gap-2">
          <button
            type="button"
            data-testid="loud-alarm-stop-btn"
            onClick={handleStop}
            className="w-full min-h-[64px] px-8 py-4 rounded-xl font-mono font-bold text-lg bg-surface text-crimson-900 active:bg-paper transition-none flex items-center justify-center gap-2 cursor-pointer uppercase tracking-wider"
          >
            <svg className="w-6 h-6 stroke-current fill-none stroke-2" strokeLinecap="square" strokeLinejoin="miter" viewBox="0 0 24 24">
              <rect height="16" width="16" x="4" y="4" />
            </svg>
            <span>{t('loudAlarm.stopBtn')}</span>
          </button>
          <span className="text-[11px] font-mono text-surface/80 text-center">
            {t('loudAlarm.stopSubtitle')}
          </span>
        </div>
      </div>
    );
  }

  // IDLE / START SCREEN
  return (
    <div
      data-testid="loud-alarm-idle-modal"
      role="dialog"
      aria-modal="true"
      aria-label={t('loudAlarm.title')}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md transition-all"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-slate-800 p-6 space-y-4 text-center shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-rose-600 rounded-full shrink-0" />
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {t('loudAlarm.title')}
            </h2>
          </div>
          <button
            type="button"
            data-testid="loud-alarm-close-btn"
            onClick={handleClose}
            aria-label={t('common.close')}
            className="w-9 h-9 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 rounded-xl transition-colors"
          >
            <svg className="w-4 h-4 stroke-current fill-none stroke-2" strokeLinecap="square" strokeLinejoin="miter" viewBox="0 0 24 24">
              <line x1="18" x2="6" y1="6" y2="18" />
              <line x1="6" x2="18" y1="6" y2="18" />
            </svg>
          </button>
        </div>

        <div className="text-left space-y-2">
          <div
            data-testid="loud-alarm-honest-note"
            className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-start gap-2.5"
          >
            <svg className="w-4 h-4 stroke-rose-600 fill-none stroke-2 shrink-0 mt-0.5" strokeLinecap="square" strokeLinejoin="miter" viewBox="0 0 24 24">
              <polygon points="12 2 2 22 22 22 12 2" />
              <line x1="12" x2="12" y1="9" y2="13" />
              <line x1="12" x2="12.01" y1="17" y2="17" />
            </svg>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {t('loudAlarm.honestNote')}
            </p>
          </div>
        </div>

        <div className="space-y-2 pt-1 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            data-testid="loud-alarm-start-btn"
            onClick={() => void handleStart()}
            className="w-full min-h-[48px] px-4 py-3 rounded-xl font-bold text-sm bg-rose-700 hover:bg-rose-800 active:bg-rose-900 text-white shadow-md flex items-center justify-center gap-2 cursor-pointer transition-colors"
          >
            <Volume2 className="w-4 h-4" />
            <span>{t('loudAlarm.startBtn')}</span>
          </button>

          <button
            type="button"
            data-testid="loud-alarm-cancel-btn"
            onClick={handleClose}
            className="w-full min-h-[44px] px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 cursor-pointer transition-colors"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};
