import React, { useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff, User, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTriggerSettingsStore } from '../store/triggerSettingsStore';
import {
  createAudioContext,
  playRingtone,
  type SoundController,
} from '../lib/safetyAudio';

export interface FakeCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  audioContext: AudioContext | null;
}

export type FakeCallStep = 'countdown' | 'ringing' | 'in_call';

export const FakeCallModal: React.FC<FakeCallModalProps> = ({
  isOpen,
  onClose,
  audioContext,
}) => {
  const { t } = useTranslation();
  const callerName = useTriggerSettingsStore((s) => s.fakeCallCallerName);
  const delaySeconds = useTriggerSettingsStore((s) => s.fakeCallDelaySeconds);

  const [step, setStep] = useState<FakeCallStep>('countdown');
  const [secondsRemaining, setSecondsRemaining] = useState<number>(delaySeconds);
  const [callDuration, setCallDuration] = useState<number>(0);

  const soundControllerRef = useRef<SoundController | null>(null);
  const isDocumentHiddenRef = useRef<boolean>(false);

  // Initialize flow when opened
  useEffect(() => {
    if (!isOpen) {
      soundControllerRef.current?.stop();
      soundControllerRef.current = null;
      setCallDuration(0);
      return;
    }

    if (delaySeconds <= 0) {
      setStep('ringing');
    } else {
      setStep('countdown');
      setSecondsRemaining(delaySeconds);
    }
  }, [isOpen, delaySeconds]);

  // Handle countdown with pause on background/lock
  useEffect(() => {
    if (!isOpen || step !== 'countdown') return;

    if (secondsRemaining <= 0) {
      setStep('ringing');
      return;
    }

    const onVisibilityChange = () => {
      isDocumentHiddenRef.current = document.hidden;
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const timer = setInterval(() => {
      // Pause countdown if document is hidden / locked
      if (isDocumentHiddenRef.current) return;

      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setStep('ringing');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [isOpen, step, secondsRemaining]);

  // Dedicated ringing audio synthesis and vibration effect
  useEffect(() => {
    if (!isOpen || step !== 'ringing') return;

    const ctx = audioContext || createAudioContext();
    if (ctx) {
      soundControllerRef.current = playRingtone(ctx);
    } else if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([1000, 1000]);
      } catch {
        // ignore
      }
    }

    return () => {
      soundControllerRef.current?.stop();
      soundControllerRef.current = null;
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate(0);
        } catch {
          // ignore
        }
      }
    };
  }, [isOpen, step, audioContext]);

  // Handle in-call duration timer
  useEffect(() => {
    if (!isOpen || step !== 'in_call') return;

    const timer = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen, step]);

  if (!isOpen) return null;

  const formatTimer = (totalSeconds: number): string => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const handleAccept = () => {
    soundControllerRef.current?.stop();
    soundControllerRef.current = null;
    setStep('in_call');
    setCallDuration(0);
  };

  const handleDeclineOrEnd = () => {
    soundControllerRef.current?.stop();
    soundControllerRef.current = null;
    onClose();
  };

  // 1. COUNTDOWN STATE
  if (step === 'countdown') {
    return (
      <div
        data-testid="fake-call-countdown-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('fakeCall.countdownTitle')}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md"
      >
        <div className="w-full max-w-sm rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-slate-800 p-6 text-center space-y-6 shadow-2xl">
          <div className="w-16 h-16 mx-auto rounded-xl bg-teal-100 dark:bg-teal-950/60 border border-teal-800/20 flex items-center justify-center text-teal-800 dark:text-teal-200 shadow-sm">
            <Phone className="w-8 h-8 animate-pulse" />
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              {t('fakeCall.countdownTitle')}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {t('fakeCall.countdownSubtitle', {
                seconds: secondsRemaining,
                name: callerName || 'Mum',
              })}
            </p>
            <div className="text-4xl font-extrabold font-mono text-teal-700 dark:text-teal-400 py-2">
              {secondsRemaining}s
            </div>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('fakeCall.backgroundLimitNote')}
          </p>

          <button
            type="button"
            data-testid="fake-call-cancel-btn"
            onClick={handleDeclineOrEnd}
            className="w-full min-h-[56px] px-6 py-3 rounded-xl font-semibold text-base bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 transition-colors flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
          >
            <X className="w-5 h-5" />
            {t('fakeCall.cancelBtn')}
          </button>
        </div>
      </div>
    );
  }

  // 2. RINGING STATE (Realistic full-screen incoming call — NO product name shown)
  if (step === 'ringing') {
    return (
      <div
        data-testid="fake-call-ringing-screen"
        role="dialog"
        aria-modal="true"
        aria-label="Incoming Call"
        className="fixed inset-0 z-50 flex flex-col justify-between items-center p-8 bg-slate-950 text-white select-none animate-in fade-in duration-200"
      >
        {/* Top caller info */}
        <div className="w-full flex flex-col items-center pt-12 space-y-4 text-center">
          <p className="text-sm font-medium tracking-wide uppercase text-slate-400">
            {t('fakeCall.incomingCallLabel')}
          </p>
          <div className="w-24 h-24 rounded-full bg-slate-800 border-2 border-slate-700 flex items-center justify-center text-slate-300 shadow-inner">
            <User className="w-12 h-12" />
          </div>
          <h1
            data-testid="fake-call-caller-name"
            className="text-3xl font-bold tracking-tight text-white"
          >
            {callerName || 'Mum'}
          </h1>
          <p className="text-base text-slate-400">
            {t('fakeCall.mobileLabel')}
          </p>
        </div>

        {/* Bottom Accept & Decline buttons */}
        <div className="w-full max-w-xs pb-12 flex items-center justify-between gap-8">
          {/* Decline button */}
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              data-testid="fake-call-decline-btn"
              onClick={handleDeclineOrEnd}
              aria-label={t('fakeCall.declineBtn')}
              className="w-18 h-18 min-w-[56px] min-h-[56px] rounded-full bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white flex items-center justify-center shadow-lg transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-rose-500/50"
            >
              <PhoneOff className="w-8 h-8" />
            </button>
            <span className="text-xs font-semibold text-slate-300">
              {t('fakeCall.declineBtn')}
            </span>
          </div>

          {/* Accept button */}
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              data-testid="fake-call-accept-btn"
              onClick={handleAccept}
              aria-label={t('fakeCall.acceptBtn')}
              className="w-18 h-18 min-w-[56px] min-h-[56px] rounded-full bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white flex items-center justify-center shadow-lg transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/50"
            >
              <Phone className="w-8 h-8" />
            </button>
            <span className="text-xs font-semibold text-slate-300">
              {t('fakeCall.acceptBtn')}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // 3. IN-CALL STATE (Realistic full-screen active call — NO product name shown)
  return (
    <div
      data-testid="fake-call-active-screen"
      role="dialog"
      aria-modal="true"
      aria-label="Active Call"
      className="fixed inset-0 z-50 flex flex-col justify-between items-center p-8 bg-slate-950 text-white select-none animate-in fade-in duration-200"
    >
      {/* Top caller info & running duration timer */}
      <div className="w-full flex flex-col items-center pt-12 space-y-4 text-center">
        <div className="w-20 h-20 rounded-full bg-slate-800 border-2 border-slate-700 flex items-center justify-center text-slate-300">
          <User className="w-10 h-10" />
        </div>
        <h1
          data-testid="fake-call-active-caller"
          className="text-2xl font-bold tracking-tight text-white"
        >
          {callerName || 'Mum'}
        </h1>
        <p
          data-testid="fake-call-timer"
          className="text-lg font-mono text-emerald-400 font-semibold"
        >
          {formatTimer(callDuration)}
        </p>
      </div>

      {/* Realistic dummy keypad/mute controls for visual realism */}
      <div className="w-full max-w-xs grid grid-cols-3 gap-6 text-center text-slate-400">
        <div className="flex flex-col items-center gap-1.5 opacity-60">
          <div className="w-14 h-14 rounded-full bg-slate-800 flex items-center justify-center">
            <span className="text-xl">🔇</span>
          </div>
          <span className="text-xs">{t('fakeCall.muteLabel')}</span>
        </div>
        <div className="flex flex-col items-center gap-1.5 opacity-60">
          <div className="w-14 h-14 rounded-full bg-slate-800 flex items-center justify-center">
            <span className="text-xl">🔢</span>
          </div>
          <span className="text-xs">{t('fakeCall.keypadLabel')}</span>
        </div>
        <div className="flex flex-col items-center gap-1.5 opacity-60">
          <div className="w-14 h-14 rounded-full bg-slate-800 flex items-center justify-center">
            <span className="text-xl">🔊</span>
          </div>
          <span className="text-xs">{t('fakeCall.speakerLabel')}</span>
        </div>
      </div>

      {/* End call button */}
      <div className="w-full max-w-xs pb-12 flex flex-col items-center gap-2">
        <button
          type="button"
          data-testid="fake-call-end-btn"
          onClick={handleDeclineOrEnd}
          aria-label={t('fakeCall.endBtn')}
          className="w-18 h-18 min-w-[56px] min-h-[56px] rounded-full bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white flex items-center justify-center shadow-lg transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-rose-500/50"
        >
          <PhoneOff className="w-8 h-8" />
        </button>
        <span className="text-xs font-semibold text-slate-300">
          {t('fakeCall.endBtn')}
        </span>
      </div>
    </div>
  );
};
