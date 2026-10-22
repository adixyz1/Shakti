import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bell, BellOff, Volume2, X } from 'lucide-react';
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

    // 1-second interval for elapsed counter, auto-stop, and steady visual rhythm
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
    // 1. Web Audio context created on this explicit user tap gesture
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

  // SOUNDING STATE: Siren active, screen wake lock on, stop button prominent
  if (alarmState === 'sounding') {
    // Background style: steady if prefers-reduced-motion, or alternating 1 Hz pulse
    const bgClass = prefersReducedMotion
      ? 'bg-rose-950'
      : flashActive
      ? 'bg-rose-700'
      : 'bg-rose-950';

    return (
      <div
        data-testid="loud-alarm-sounding-screen"
        role="dialog"
        aria-modal="true"
        aria-label={t('loudAlarm.soundingTitle')}
        className={`fixed inset-0 z-50 flex flex-col justify-between items-center p-8 text-white select-none transition-colors duration-500 ${bgClass}`}
      >
        {/* Top header & countdown */}
        <div className="w-full max-w-sm flex flex-col items-center pt-8 text-center space-y-4">
          <div className="w-20 h-20 rounded-full bg-white/20 border-2 border-white/40 flex items-center justify-center text-white shadow-xl">
            <Volume2 className="w-10 h-10 animate-pulse" />
          </div>

          <div className="space-y-1">
            <h1 className="text-3xl font-extrabold tracking-tight text-white uppercase">
              {t('loudAlarm.soundingTitle')}
            </h1>
            <p className="text-sm font-medium text-rose-100">
              {t('loudAlarm.autoStopNotice', {
                time: formatRemainingTime(elapsedSeconds),
              })}
            </p>
          </div>

          {prefersReducedMotion && (
            <span
              data-testid="reduced-motion-indicator"
              className="text-xs bg-rose-900/60 px-3 py-1 rounded-full text-rose-200 border border-rose-800"
            >
              {t('loudAlarm.reducedMotionNotice')}
            </span>
          )}
        </div>

        {/* Big clearly labeled STOP button (min 56px touch target) */}
        <div className="w-full max-w-xs pb-12 flex flex-col items-center gap-3">
          <button
            type="button"
            data-testid="loud-alarm-stop-btn"
            onClick={handleStop}
            className="w-full min-h-[64px] px-8 py-4 rounded-3xl font-bold text-xl bg-white hover:bg-slate-100 text-rose-900 shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white"
          >
            <BellOff className="w-7 h-7" />
            {t('loudAlarm.stopBtn')}
          </button>
          <span className="text-xs text-rose-200 text-center">
            {t('loudAlarm.stopSubtitle')}
          </span>
        </div>
      </div>
    );
  }

  // IDLE / START SCREEN: Honest note, large Start button, cancel/close button
  return (
    <div
      data-testid="loud-alarm-idle-modal"
      role="dialog"
      aria-modal="true"
      aria-label={t('loudAlarm.title')}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-6 text-center">
        <div className="flex items-center justify-between">
          <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-950 flex items-center justify-center text-amber-700 dark:text-amber-300">
            <Bell className="w-6 h-6" />
          </div>
          <button
            type="button"
            data-testid="loud-alarm-close-btn"
            onClick={handleClose}
            aria-label={t('common.close')}
            className="w-11 h-11 rounded-full flex items-center justify-center text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-2 text-left">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            {t('loudAlarm.title')}
          </h2>
          {/* Honest note on the start screen */}
          <div
            data-testid="loud-alarm-honest-note"
            className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-900/60 flex items-start gap-3"
          >
            <AlertTriangle className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs leading-relaxed text-amber-950 dark:text-amber-200">
              {t('loudAlarm.honestNote')}
            </p>
          </div>
        </div>

        {/* Action buttons: 56px minimum touch targets */}
        <div className="space-y-3 pt-2">
          <button
            type="button"
            data-testid="loud-alarm-start-btn"
            onClick={() => void handleStart()}
            className="w-full min-h-[56px] px-6 py-3.5 rounded-2xl font-bold text-base bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white shadow-lg transition-transform active:scale-98 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-rose-500/50"
          >
            <Volume2 className="w-5 h-5" />
            {t('loudAlarm.startBtn')}
          </button>

          <button
            type="button"
            data-testid="loud-alarm-cancel-btn"
            onClick={handleClose}
            className="w-full min-h-[56px] px-6 py-3 rounded-2xl font-semibold text-sm bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors flex items-center justify-center focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-500/50"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};
