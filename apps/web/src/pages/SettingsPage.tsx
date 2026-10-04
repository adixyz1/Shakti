import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  BatteryCharging,
  Calculator,
  CheckCircle2,
  Delete,
  KeyRound,
  Keyboard,
  Mic,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import { BigButton, Button, Card, Input } from '../components/ui';
import { LanguageToggle } from '../components/LanguageToggle';
import { PageLayout } from '../components/PageLayout';
import { useAuthStore } from '../store/authStore';
import { useTriggerSettingsStore } from '../store/triggerSettingsStore';
import { authApi, consentsApi, settingsApi } from '../lib/api';
import {
  setPracticeModeTarget,
  subscribePracticeTrigger,
} from '../lib/sos';
import {
  getSpeechRecognitionConstructor,
  isDeviceMotionSupported,
} from '../components/DiscreetTriggersManager';
import { DisguiseCalculator } from '../components/DisguiseCalculator';

type PinSetupTarget = 'cancel' | 'duress' | null;

export const SettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, setUser, toggleDarkMode, addToast } = useAuthStore();

  const {
    tripleTapEnabled,
    tripleTapZone,
    shortcutEnabled,
    shortcutCombo,
    shakeEnabled,
    shakeThreshold,
    shakePermissionState,
    voiceEnabled,
    voiceCodeword,
    voiceConsentGranted,
    disguiseEnabled,
    disguiseSequenceHash,
    lowPowerDataSaverMode,
    setTripleTapEnabled,
    setTripleTapZone,
    setShortcutEnabled,
    setShortcutCombo,
    setShakeEnabled,
    setShakeThreshold,
    setShakePermissionState,
    setVoiceEnabled,
    setVoiceCodeword,
    setVoiceConsentGranted,
    setDisguiseEnabled,
    configureDisguiseSequence,
    setLowPowerDataSaverMode,
  } = useTriggerSettingsStore();

  // Cancel Window (0-10s)
  const [cancelWindowSeconds, setCancelWindowSeconds] = useState<number>(
    user?.cancel_window_seconds ?? 5
  );
  const [isSavingWindow, setIsSavingWindow] = useState(false);

  // PIN Setup Numeric Keypad State (never persisted to storage; held only in transient memory to check matching PINs in-session)
  const [pinTarget, setPinTarget] = useState<PinSetupTarget>(null);
  const [pinStep, setPinStep] = useState<1 | 2>(1);
  const [firstPinEntry, setFirstPinEntry] = useState<string>('');
  const [confirmPinEntry, setConfirmPinEntry] = useState<string>('');
  const [pinSetupError, setPinSetupError] = useState<string | null>(null);
  const [isSavingPin, setIsSavingPin] = useState(false);
  const [transientKnownCancelPin, setTransientKnownCancelPin] = useState<
    string | null
  >(null);
  const [transientKnownDuressPin, setTransientKnownDuressPin] = useState<
    string | null
  >(null);

  // Fix 1: Disguise sequence setup (NO default sequence; requires min length 4 + confirm entry; stored as salted SHA-256 hash)
  const [showDisguiseSetup, setShowDisguiseSetup] = useState(false);
  const [disguiseSeqInput, setDisguiseSeqInput] = useState<string>('');
  const [disguiseSeqConfirm, setDisguiseSeqConfirm] = useState<string>('');
  const [disguiseError, setDisguiseError] = useState<string | null>(null);
  const [showPracticeDisguise, setShowPracticeDisguise] = useState(false);

  // Battery API low-power suggestion
  const [lowBatteryDetected, setLowBatteryDetected] = useState<number | null>(
    null
  );

  // Practice mode state for triggers
  const [practiceTrigger, setPracticeTrigger] = useState<string | null>(null);
  const [practiceSuccessSource, setPracticeSuccessSource] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (user?.cancel_window_seconds !== undefined) {
      setCancelWindowSeconds(user.cancel_window_seconds);
    }
  }, [user?.cancel_window_seconds]);

  // Task 10: Check Battery API for low battery suggestion
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const navAny = navigator as any;
    if (typeof navAny.getBattery !== 'function') return;

    let mounted = true;
    void Promise.resolve(navAny.getBattery())
      .then((battery: any) => {
        if (!mounted || !battery) return;
        const checkLevel = () => {
          if (
            typeof battery.level === 'number' &&
            battery.level <= 0.2 &&
            !battery.charging
          ) {
            setLowBatteryDetected(Math.round(battery.level * 100));
          } else {
            setLowBatteryDetected(null);
          }
        };
        checkLevel();
        if (typeof battery.addEventListener === 'function') {
          battery.addEventListener('levelchange', checkLevel);
          battery.addEventListener('chargingchange', checkLevel);
        }
      })
      .catch(() => {
        // ignore if unsupported
      });

    return () => {
      mounted = false;
    };
  }, []);

  // Subscribe to harmless practice trigger firings
  useEffect(() => {
    const unsub = subscribePracticeTrigger((source) => {
      setPracticeSuccessSource(source);
      setPracticeTrigger(null);
      setPracticeModeTarget(null);
    });
    return () => {
      unsub();
      setPracticeModeTarget(null);
    };
  }, []);

  const refreshUserProfile = async () => {
    try {
      const fresh = await authApi.getMe();
      setUser(fresh);
    } catch {
      // ignore
    }
  };

  const handleSaveCancelWindow = async (nextSec: number) => {
    setCancelWindowSeconds(nextSec);
    setIsSavingWindow(true);
    try {
      const res = await settingsApi.updateCancelWindow(nextSec);
      if (user) {
        setUser({
          ...user,
          cancel_window_seconds: res.cancel_window_seconds,
        });
      }
      addToast(t('settings.cancelWindowSaved'), 'success');
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to update cancel window',
        'error'
      );
    } finally {
      setIsSavingWindow(false);
    }
  };

  const startPinSetup = (target: 'cancel' | 'duress') => {
    setPinTarget(target);
    setPinStep(1);
    setFirstPinEntry('');
    setConfirmPinEntry('');
    setPinSetupError(null);
  };

  const closePinSetup = () => {
    setPinTarget(null);
    setPinStep(1);
    setFirstPinEntry('');
    setConfirmPinEntry('');
    setPinSetupError(null);
  };

  const currentPinValue = pinStep === 1 ? firstPinEntry : confirmPinEntry;
  const setCurrentPinValue = (val: string) => {
    if (pinStep === 1) {
      setFirstPinEntry(val);
    } else {
      setConfirmPinEntry(val);
    }
    setPinSetupError(null);
  };

  const handlePinNextOrSave = async () => {
    if (!pinTarget) return;

    if (pinStep === 1) {
      if (firstPinEntry.length < 4 || firstPinEntry.length > 8) {
        setPinSetupError(t('settings.pins.errorLength'));
        return;
      }
      if (
        pinTarget === 'cancel' &&
        transientKnownDuressPin &&
        firstPinEntry === transientKnownDuressPin
      ) {
        setPinSetupError(t('settings.pins.errorMatchingPins'));
        return;
      }
      if (
        pinTarget === 'duress' &&
        transientKnownCancelPin &&
        firstPinEntry === transientKnownCancelPin
      ) {
        setPinSetupError(t('settings.pins.errorMatchingPins'));
        return;
      }

      setPinStep(2);
      setConfirmPinEntry('');
      setPinSetupError(null);
      return;
    }

    // Step 2: Confirm & Save
    if (confirmPinEntry !== firstPinEntry) {
      setPinSetupError(t('settings.pins.errorMismatch'));
      setConfirmPinEntry('');
      return;
    }

    if (
      (pinTarget === 'cancel' &&
        transientKnownDuressPin &&
        confirmPinEntry === transientKnownDuressPin) ||
      (pinTarget === 'duress' &&
        transientKnownCancelPin &&
        confirmPinEntry === transientKnownCancelPin)
    ) {
      setPinSetupError(t('settings.pins.errorMatchingPins'));
      return;
    }

    setIsSavingPin(true);
    setPinSetupError(null);
    try {
      if (pinTarget === 'cancel') {
        await settingsApi.updateCancelPin(confirmPinEntry);
        setTransientKnownCancelPin(confirmPinEntry);
        if (user) {
          setUser({ ...user, has_cancel_pin: true });
        }
        await refreshUserProfile();
        addToast(t('settings.pins.savedCancelPin'), 'success');
      } else {
        await settingsApi.updateDuressPin({
          pin: confirmPinEntry,
          ...(transientKnownCancelPin
            ? { cancel_pin: transientKnownCancelPin }
            : {}),
        });
        setTransientKnownDuressPin(confirmPinEntry);
        if (user) {
          setUser({ ...user, has_duress_pin: true });
        }
        await refreshUserProfile();
        addToast(t('settings.pins.savedDuressPin'), 'success');
      }
      closePinSetup();
    } catch (err) {
      setPinSetupError(
        err instanceof Error ? err.message : t('settings.pins.errorMatchingPins')
      );
    } finally {
      setIsSavingPin(false);
    }
  };

  const handleRemovePin = async (target: 'cancel' | 'duress') => {
    setIsSavingPin(true);
    try {
      if (target === 'cancel') {
        await settingsApi.updateCancelPin(null);
        setTransientKnownCancelPin(null);
        if (user) {
          setUser({ ...user, has_cancel_pin: false });
        }
        await refreshUserProfile();
        addToast(t('settings.pins.removedCancelPin'), 'info');
      } else {
        await settingsApi.updateDuressPin({ pin: null });
        setTransientKnownDuressPin(null);
        if (user) {
          setUser({ ...user, has_duress_pin: false });
        }
        await refreshUserProfile();
        addToast(t('settings.pins.removedDuressPin'), 'info');
      }
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to remove PIN',
        'error'
      );
    } finally {
      setIsSavingPin(false);
    }
  };

  const handleSaveDisguiseSequence = async () => {
    setDisguiseError(null);
    const seq1 = disguiseSeqInput.trim();
    const seq2 = disguiseSeqConfirm.trim();

    if (seq1.length < 4) {
      setDisguiseError(t('settings.disguise.errorMinLength'));
      return;
    }
    if (!/^[0-9+\-*/.%]+=+$/.test(seq1)) {
      setDisguiseError(t('settings.disguise.errorFormat'));
      return;
    }
    if (seq1 !== seq2) {
      setDisguiseError(t('settings.disguise.errorMismatch'));
      return;
    }

    await configureDisguiseSequence(seq1);
    setDisguiseSeqInput('');
    setDisguiseSeqConfirm('');
    setShowDisguiseSetup(false);
    addToast(t('settings.disguise.savedSequenceToast'), 'success');
  };

  const handleRequestIosShakePermission = async () => {
    if (typeof window === 'undefined') return;
    const DeviceMotionEventAny = (window as any).DeviceMotionEvent;
    if (
      DeviceMotionEventAny &&
      typeof DeviceMotionEventAny.requestPermission === 'function'
    ) {
      try {
        const result = await DeviceMotionEventAny.requestPermission();
        if (result === 'granted') {
          setShakePermissionState('granted');
          setShakeEnabled(true);
          addToast(t('settings.triggers.shakePermissionGranted'), 'success');
        } else {
          setShakePermissionState('denied');
          setShakeEnabled(false);
          addToast(t('settings.triggers.shakePermissionDenied'), 'error');
        }
      } catch {
        setShakePermissionState('denied');
      }
    } else {
      setShakePermissionState('granted');
    }
  };

  const handleGrantVoiceConsent = async () => {
    setVoiceConsentGranted(true);
    try {
      await consentsApi.postConsent({
        type: 'microphone',
        granted: true,
        source: 'settings_voice_trigger',
      });
    } catch {
      // Consent state is still saved in triggerSettingsStore if offline/test
    }
  };

  const togglePracticeForTrigger = (triggerName: string) => {
    if (practiceTrigger === triggerName) {
      setPracticeTrigger(null);
      setPracticeModeTarget(null);
    } else {
      setPracticeSuccessSource(null);
      setPracticeTrigger(triggerName);
      setPracticeModeTarget(triggerName);
    }
  };

  const deviceMotionSupported = isDeviceMotionSupported();
  const speechRecognitionSupported = Boolean(getSpeechRecognitionConstructor());
  const needsIosMotionPermission =
    typeof window !== 'undefined' &&
    Boolean((window as any).DeviceMotionEvent) &&
    typeof (window as any).DeviceMotionEvent.requestPermission === 'function';

  if (showPracticeDisguise && disguiseSequenceHash) {
    return (
      <DisguiseCalculator
        sequenceHash={disguiseSequenceHash}
        onUnlock={() => {
          setShowPracticeDisguise(false);
          setPracticeSuccessSource('disguise_unlock');
        }}
      />
    );
  }

  return (
    <PageLayout>
      <div className="space-y-8 py-4 max-w-3xl">
        <header className="space-y-2 border-b border-slate-200 dark:border-slate-800 pb-6">
          <h1 className="text-2xl md:text-3xl font-semibold text-slate-900 dark:text-slate-50">
            {t('settings.title')}
          </h1>
          <p className="text-sm md:text-base text-slate-600 dark:text-slate-300">
            {t('settings.subtitle')}
          </p>
        </header>

        {/* Task 8: Plain Safety Wording Notice */}
        <div
          role="region"
          aria-label={t('settings.safetyWordingTitle')}
          data-testid="settings-safety-wording"
          className="rounded-2xl border border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 p-5 space-y-2"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h2 className="text-base font-bold text-amber-950 dark:text-amber-100">
                {t('settings.safetyWordingTitle')}
              </h2>
              <p className="text-sm text-amber-900 dark:text-amber-200 leading-relaxed">
                {t('settings.safetyWordingBody')}
              </p>
            </div>
          </div>
        </div>

        {/* Practice Mode Active / Success Banners */}
        {practiceTrigger && (
          <div
            role="status"
            data-testid="practice-active-banner"
            className="rounded-2xl border-2 border-teal-600 bg-teal-50 dark:bg-teal-950/60 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <p className="text-sm font-semibold text-teal-950 dark:text-teal-100">
              {t('settings.triggers.practiceActiveBanner', {
                trigger: practiceTrigger,
              })}
            </p>
            <Button
              type="button"
              variant="outline"
              data-testid="stop-practice-btn"
              onClick={() => {
                setPracticeTrigger(null);
                setPracticeModeTarget(null);
              }}
            >
              {t('settings.triggers.practiceStopBtn')}
            </Button>
          </div>
        )}

        {practiceSuccessSource && (
          <div
            role="status"
            data-testid="practice-success-banner"
            className="rounded-2xl border-2 border-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 p-4 flex items-center gap-3"
          >
            <CheckCircle2 className="w-6 h-6 text-emerald-700 dark:text-emerald-400 shrink-0" />
            <p className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">
              {t('settings.triggers.practiceSuccessBanner', {
                source: practiceSuccessSource,
              })}
            </p>
          </div>
        )}

        {/* Task 7: Cancel Window Length (0-10s) */}
        <Card className="space-y-4" data-testid="cancel-window-card">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {t('settings.cancelWindowTitle')}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {t('settings.cancelWindowBody')}
            </p>
          </div>

          <div className="space-y-3">
            <label
              htmlFor="cancel-window-slider"
              className="block text-sm font-semibold text-teal-800 dark:text-teal-300"
            >
              {t('settings.cancelWindowLabel', {
                seconds: cancelWindowSeconds,
              })}
            </label>
            <input
              id="cancel-window-slider"
              data-testid="cancel-window-slider"
              type="range"
              min={0}
              max={10}
              step={1}
              disabled={isSavingWindow}
              value={cancelWindowSeconds}
              onChange={(e) =>
                void handleSaveCancelWindow(Number(e.target.value))
              }
              className="w-full h-3 accent-teal-700 cursor-pointer"
            />
            <div className="flex flex-wrap gap-2 pt-1">
              {[0, 3, 5, 8, 10].map((sec) => (
                <button
                  key={sec}
                  type="button"
                  data-testid={`cancel-window-preset-${sec}`}
                  disabled={isSavingWindow}
                  onClick={() => void handleSaveCancelWindow(sec)}
                  className={`min-h-[56px] min-w-[56px] px-4 rounded-xl text-sm font-semibold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${
                    cancelWindowSeconds === sec
                      ? 'bg-teal-700 text-white border-teal-700'
                      : 'bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {sec}s
                </button>
              ))}
            </div>
          </div>
        </Card>

        {/* Task 6: Cancel PIN & Silent Duress PIN Settings */}
        <Card className="space-y-5" data-testid="pin-settings-card">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-teal-700 dark:text-teal-400" />
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {t('settings.pins.sectionTitle')}
              </h2>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {t('settings.pins.sectionSubtitle')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Cancel PIN Box */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3 flex flex-col justify-between">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {t('settings.pins.cancelPinTitle')}
                  </h3>
                  <span
                    data-testid="cancel-pin-status"
                    className="text-xs font-semibold text-teal-700 dark:text-teal-400"
                  >
                    {user?.has_cancel_pin
                      ? t('settings.pins.statusConfigured')
                      : t('settings.pins.statusNotConfigured')}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {t('settings.pins.cancelPinDesc')}
                </p>
              </div>
              <div className="space-y-2 pt-2">
                <BigButton
                  type="button"
                  variant="primary"
                  data-testid="open-cancel-pin-setup-btn"
                  onClick={() => startPinSetup('cancel')}
                >
                  {t('settings.pins.setCancelPinBtn')}
                </BigButton>
                {user?.has_cancel_pin && (
                  <BigButton
                    type="button"
                    variant="outline"
                    data-testid="remove-cancel-pin-btn"
                    onClick={() => void handleRemovePin('cancel')}
                  >
                    {t('settings.pins.removeCancelPinBtn')}
                  </BigButton>
                )}
              </div>
            </div>

            {/* Duress PIN Box */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3 flex flex-col justify-between">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {t('settings.pins.duressPinTitle')}
                  </h3>
                  <span
                    data-testid="duress-pin-status"
                    className="text-xs font-semibold text-teal-700 dark:text-teal-400"
                  >
                    {user?.has_duress_pin
                      ? t('settings.pins.statusConfigured')
                      : t('settings.pins.statusNotConfigured')}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {t('settings.pins.duressPinDesc')}
                </p>
              </div>
              <div className="space-y-2 pt-2">
                <BigButton
                  type="button"
                  variant="secondary"
                  data-testid="open-duress-pin-setup-btn"
                  onClick={() => startPinSetup('duress')}
                >
                  {t('settings.pins.setDuressPinBtn')}
                </BigButton>
                {user?.has_duress_pin && (
                  <BigButton
                    type="button"
                    variant="outline"
                    data-testid="remove-duress-pin-btn"
                    onClick={() => void handleRemovePin('duress')}
                  >
                    {t('settings.pins.removeDuressPinBtn')}
                  </BigButton>
                )}
              </div>
            </div>
          </div>

          {/* On-Screen Numeric PIN Keypad for Setting/Changing PIN */}
          {pinTarget && (
            <div
              data-testid="settings-pin-keypad"
              className="rounded-2xl border-2 border-teal-600 bg-slate-50 dark:bg-slate-900 p-5 space-y-4"
            >
              <div className="text-center space-y-1">
                <h3
                  data-testid="settings-pin-step-title"
                  className="text-base font-bold text-slate-900 dark:text-slate-100"
                >
                  {pinStep === 1
                    ? t('settings.pins.stepEnterNew', {
                        type:
                          pinTarget === 'cancel'
                            ? t('settings.pins.cancelPinTitle')
                            : t('settings.pins.duressPinTitle'),
                      })
                    : t('settings.pins.stepConfirmNew', {
                        type:
                          pinTarget === 'cancel'
                            ? t('settings.pins.cancelPinTitle')
                            : t('settings.pins.duressPinTitle'),
                      })}
                </h3>
              </div>

              <div
                aria-label="Entered PIN digits"
                data-testid="settings-pin-display"
                className="min-h-[56px] rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 flex items-center justify-center text-2xl font-mono tracking-widest text-slate-900 dark:text-slate-100"
              >
                {currentPinValue.length > 0
                  ? '●'.repeat(currentPinValue.length)
                  : '—'}
              </div>

              {pinSetupError && (
                <p
                  role="alert"
                  data-testid="settings-pin-error"
                  className="text-sm font-semibold text-center text-rose-700 dark:text-rose-400"
                >
                  {pinSetupError}
                </p>
              )}

              <div className="grid grid-cols-3 gap-2.5">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                  <button
                    key={digit}
                    type="button"
                    data-testid={`settings-pin-digit-${digit}`}
                    aria-label={`PIN digit ${digit}`}
                    onClick={() => {
                      if (currentPinValue.length < 8) {
                        setCurrentPinValue(currentPinValue + digit);
                      }
                    }}
                    className="min-h-[56px] rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-xl font-bold text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                  >
                    {digit}
                  </button>
                ))}
                <button
                  type="button"
                  data-testid="settings-pin-clear"
                  onClick={() => setCurrentPinValue('')}
                  className="min-h-[56px] rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 text-xs font-semibold text-slate-800 dark:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                >
                  {t('sos.cancelWindow.pinClear')}
                </button>
                <button
                  type="button"
                  data-testid="settings-pin-digit-0"
                  aria-label="PIN digit 0"
                  onClick={() => {
                    if (currentPinValue.length < 8) {
                      setCurrentPinValue(currentPinValue + '0');
                    }
                  }}
                  className="min-h-[56px] rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-xl font-bold text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                >
                  0
                </button>
                <button
                  type="button"
                  data-testid="settings-pin-backspace"
                  aria-label={t('sos.cancelWindow.pinBackspace')}
                  onClick={() =>
                    setCurrentPinValue(currentPinValue.slice(0, -1))
                  }
                  className="min-h-[56px] rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 inline-flex items-center justify-center text-slate-800 dark:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                >
                  <Delete className="w-5 h-5" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <BigButton
                  type="button"
                  variant="primary"
                  data-testid="settings-pin-submit-btn"
                  isLoading={isSavingPin}
                  onClick={() => void handlePinNextOrSave()}
                >
                  {pinStep === 1
                    ? t('settings.pins.nextConfirmBtn')
                    : t('settings.pins.savePinBtn')}
                </BigButton>
                <BigButton
                  type="button"
                  variant="outline"
                  data-testid="settings-pin-cancel-btn"
                  onClick={closePinSetup}
                >
                  {t('settings.pins.cancelSetupBtn')}
                </BigButton>
              </div>
            </div>
          )}
        </Card>

        {/* Task 5 & Fix 1: Disguise Mode (Calculator) — No default sequence; requires min length 4 + confirm entry */}
        <Card className="space-y-4" data-testid="disguise-settings-card">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Calculator className="w-5 h-5 text-teal-700 dark:text-teal-400" />
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {t('settings.disguise.sectionTitle')}
                </h2>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {t('settings.disguise.sectionBody')}
              </p>
            </div>
            <span
              data-testid="disguise-sequence-status"
              className="text-xs font-semibold text-teal-700 dark:text-teal-400 shrink-0"
            >
              {disguiseSequenceHash
                ? t('settings.pins.statusConfigured')
                : t('settings.pins.statusNotConfigured')}
            </span>
          </div>

          <label className="min-h-[56px] flex items-center justify-between gap-4 px-4 rounded-xl bg-slate-100 dark:bg-slate-800/70 cursor-pointer">
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t('settings.disguise.enableLabel')}
            </span>
            <input
              type="checkbox"
              data-testid="toggle-disguise-mode"
              checked={disguiseEnabled}
              onChange={(e) => {
                if (e.target.checked && !disguiseSequenceHash) {
                  setShowDisguiseSetup(true);
                  setDisguiseError(t('settings.disguise.requireCustomSequence'));
                  return;
                }
                setDisguiseEnabled(e.target.checked);
              }}
              className="w-6 h-6 accent-teal-700"
            />
          </label>

          {showDisguiseSetup || !disguiseSequenceHash ? (
            <div
              data-testid="disguise-sequence-setup"
              className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3"
            >
              <Input
                label={t('settings.disguise.secretSequenceLabel')}
                data-testid="disguise-secret-input"
                type="password"
                placeholder="e.g. 2580="
                value={disguiseSeqInput}
                onChange={(e) => {
                  setDisguiseSeqInput(e.target.value);
                  setDisguiseError(null);
                }}
              />
              <Input
                label={t('settings.disguise.confirmSequenceLabel')}
                data-testid="disguise-secret-confirm-input"
                type="password"
                placeholder="Re-enter sequence (e.g. 2580=)"
                value={disguiseSeqConfirm}
                onChange={(e) => {
                  setDisguiseSeqConfirm(e.target.value);
                  setDisguiseError(null);
                }}
              />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('settings.disguise.secretSequenceHint')}
              </p>
              {disguiseError && (
                <p
                  role="alert"
                  data-testid="disguise-sequence-error"
                  className="text-sm font-semibold text-rose-700 dark:text-rose-400"
                >
                  {disguiseError}
                </p>
              )}
              <BigButton
                type="button"
                variant="secondary"
                data-testid="save-disguise-sequence-btn"
                onClick={() => void handleSaveDisguiseSequence()}
              >
                {t('settings.disguise.saveSequenceBtn')}
              </BigButton>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <BigButton
                type="button"
                variant="secondary"
                data-testid="change-disguise-sequence-btn"
                onClick={() => {
                  setShowDisguiseSetup(true);
                  setDisguiseError(null);
                }}
              >
                {t('settings.disguise.changeSequenceBtn')}
              </BigButton>
              <BigButton
                type="button"
                variant="outline"
                data-testid="practice-disguise-btn"
                onClick={() => setShowPracticeDisguise(true)}
              >
                {t('settings.disguise.testDisguiseBtn')}
              </BigButton>
            </div>
          )}
        </Card>

        {/* Task 10 (Phase 5): Low-Battery / Data-Saver Mode */}
        <Card className="space-y-4" data-testid="low-power-settings-card">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <BatteryCharging className="w-5 h-5 text-teal-700 dark:text-teal-400" />
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {t('offline.lowPowerTitle')}
              </h2>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {t('offline.lowPowerBody')}
            </p>
          </div>

          {lowBatteryDetected !== null && !lowPowerDataSaverMode && (
            <div
              role="status"
              data-testid="low-battery-suggestion"
              className="rounded-xl border border-amber-400 bg-amber-50 dark:bg-amber-950/60 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <p className="text-xs font-semibold text-amber-950 dark:text-amber-100">
                {t('offline.lowBatterySuggestion', {
                  percent: lowBatteryDetected,
                })}
              </p>
              <Button
                type="button"
                variant="primary"
                data-testid="accept-low-battery-btn"
                onClick={() => setLowPowerDataSaverMode(true)}
              >
                {t('offline.enableLowPowerBtn')}
              </Button>
            </div>
          )}

          <label className="min-h-[56px] flex items-center justify-between gap-4 px-4 rounded-xl bg-slate-100 dark:bg-slate-800/70 cursor-pointer">
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t('offline.lowPowerToggleLabel')}
            </span>
            <input
              type="checkbox"
              data-testid="toggle-low-power-mode"
              checked={lowPowerDataSaverMode}
              onChange={(e) => setLowPowerDataSaverMode(e.target.checked)}
              className="w-6 h-6 accent-teal-700"
            />
          </label>
        </Card>

        {/* Tasks 1, 2, 3, 4 & 7: Discreet Triggers + Practice Mode */}
        <section className="space-y-4" data-testid="discreet-triggers-section">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
              {t('settings.triggers.sectionTitle')}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {t('settings.triggers.sectionSubtitle')}
            </p>
          </div>

          {/* 1. Triple-Tap Trigger */}
          <Card className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {t('settings.triggers.tripleTapTitle')}
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {t('settings.triggers.tripleTapBody')}
              </p>
            </div>

            <label className="min-h-[56px] flex items-center justify-between gap-4 px-4 rounded-xl bg-slate-100 dark:bg-slate-800/70 cursor-pointer">
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {t('settings.triggers.tripleTapEnable')}
              </span>
              <input
                type="checkbox"
                data-testid="toggle-triple-tap"
                checked={tripleTapEnabled}
                onChange={(e) => setTripleTapEnabled(e.target.checked)}
                className="w-6 h-6 accent-teal-700"
              />
            </label>

            <div className="space-y-1.5">
              <label
                htmlFor="triple-tap-zone-select"
                className="block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                {t('settings.triggers.tripleTapZoneLabel')}
              </label>
              <select
                id="triple-tap-zone-select"
                data-testid="triple-tap-zone-select"
                value={tripleTapZone}
                onChange={(e) =>
                  setTripleTapZone(e.target.value as 'logo' | 'footer')
                }
                className="w-full min-h-[56px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              >
                <option value="logo">
                  {t('settings.triggers.tripleTapZoneLogo')}
                </option>
                <option value="footer">
                  {t('settings.triggers.tripleTapZoneFooter')}
                </option>
              </select>
            </div>

            <BigButton
              type="button"
              variant="outline"
              data-testid="practice-triple-tap-btn"
              onClick={() => togglePracticeForTrigger('triple_tap')}
            >
              {practiceTrigger === 'triple_tap'
                ? t('settings.triggers.practiceStopBtn')
                : t('settings.triggers.practiceBtn')}
            </BigButton>
          </Card>

          {/* 2. Keyboard Shortcut (Desktop) */}
          <Card className="space-y-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Keyboard className="w-5 h-5 text-teal-700 dark:text-teal-400" />
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {t('settings.triggers.shortcutTitle')}
                </h3>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {t('settings.triggers.shortcutBody')}
              </p>
            </div>

            <label className="min-h-[56px] flex items-center justify-between gap-4 px-4 rounded-xl bg-slate-100 dark:bg-slate-800/70 cursor-pointer">
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {t('settings.triggers.shortcutEnable')}
              </span>
              <input
                type="checkbox"
                data-testid="toggle-shortcut"
                checked={shortcutEnabled}
                onChange={(e) => setShortcutEnabled(e.target.checked)}
                className="w-6 h-6 accent-teal-700"
              />
            </label>

            <Input
              label={t('settings.triggers.shortcutComboLabel')}
              data-testid="shortcut-combo-input"
              data-shortcut-recorder="true"
              value={shortcutCombo}
              onChange={(e) => setShortcutCombo(e.target.value)}
            />

            <BigButton
              type="button"
              variant="outline"
              data-testid="practice-shortcut-btn"
              onClick={() => togglePracticeForTrigger('keyboard_shortcut')}
            >
              {practiceTrigger === 'keyboard_shortcut'
                ? t('settings.triggers.practiceStopBtn')
                : t('settings.triggers.practiceBtn')}
            </BigButton>
          </Card>

          {/* 3. Shake Detection */}
          <Card className="space-y-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-teal-700 dark:text-teal-400" />
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {t('settings.triggers.shakeTitle')}
                </h3>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {t('settings.triggers.shakeBody')}
              </p>
            </div>

            {!deviceMotionSupported ? (
              <p
                data-testid="shake-unsupported-msg"
                className="text-sm font-medium text-amber-800 dark:text-amber-300"
              >
                {t('settings.triggers.shakeUnsupported')}
              </p>
            ) : (
              <>
                {needsIosMotionPermission &&
                  shakePermissionState !== 'granted' && (
                    <BigButton
                      type="button"
                      variant="secondary"
                      data-testid="request-ios-shake-permission-btn"
                      onClick={() => void handleRequestIosShakePermission()}
                    >
                      {t('settings.triggers.shakePermissionBtn')}
                    </BigButton>
                  )}

                <label className="min-h-[56px] flex items-center justify-between gap-4 px-4 rounded-xl bg-slate-100 dark:bg-slate-800/70 cursor-pointer">
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {t('settings.triggers.shakeEnable')}
                  </span>
                  <input
                    type="checkbox"
                    data-testid="toggle-shake"
                    checked={shakeEnabled}
                    onChange={(e) => setShakeEnabled(e.target.checked)}
                    className="w-6 h-6 accent-teal-700"
                  />
                </label>

                <div className="space-y-1">
                  <label
                    htmlFor="shake-threshold-slider"
                    className="block text-sm font-medium text-slate-700 dark:text-slate-300"
                  >
                    {t('settings.triggers.shakeThresholdLabel', {
                      value: shakeThreshold,
                    })}
                  </label>
                  <input
                    id="shake-threshold-slider"
                    data-testid="shake-threshold-slider"
                    type="range"
                    min={15}
                    max={45}
                    step={1}
                    value={shakeThreshold}
                    onChange={(e) =>
                      setShakeThreshold(Number(e.target.value))
                    }
                    className="w-full h-3 accent-teal-700 cursor-pointer"
                  />
                </div>

                <BigButton
                  type="button"
                  variant="outline"
                  data-testid="practice-shake-btn"
                  onClick={() => togglePracticeForTrigger('shake')}
                >
                  {practiceTrigger === 'shake'
                    ? t('settings.triggers.practiceStopBtn')
                    : t('settings.triggers.practiceBtn')}
                </BigButton>
              </>
            )}
          </Card>

          {/* 4. Voice Code Word (Experimental) */}
          <Card className="space-y-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Mic className="w-5 h-5 text-teal-700 dark:text-teal-400" />
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {t('settings.triggers.voiceTitle')}
                </h3>
              </div>
              <p
                data-testid="voice-experimental-label"
                className="text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{t('settings.triggers.voiceExperimentalBadge')}</span>
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {t('settings.triggers.voiceBody')}
              </p>
            </div>

            {!speechRecognitionSupported ? (
              <p
                data-testid="voice-unsupported-msg"
                className="text-sm font-medium text-amber-800 dark:text-amber-300"
              >
                {t('settings.triggers.voiceUnsupported')}
              </p>
            ) : !voiceConsentGranted ? (
              <div
                data-testid="voice-consent-step"
                className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50/70 dark:bg-amber-950/40 p-4 space-y-3"
              >
                <h4 className="text-sm font-bold text-amber-950 dark:text-amber-100">
                  {t('settings.triggers.voiceConsentStepTitle')}
                </h4>
                <p className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                  {t('settings.triggers.voiceConsentStepBody')}
                </p>
                <BigButton
                  type="button"
                  variant="secondary"
                  data-testid="grant-voice-consent-btn"
                  onClick={() => void handleGrantVoiceConsent()}
                >
                  {t('settings.triggers.voiceGrantConsentBtn')}
                </BigButton>
              </div>
            ) : (
              <>
                <label className="min-h-[56px] flex items-center justify-between gap-4 px-4 rounded-xl bg-slate-100 dark:bg-slate-800/70 cursor-pointer">
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {t('settings.triggers.voiceEnable')}
                  </span>
                  <input
                    type="checkbox"
                    data-testid="toggle-voice"
                    checked={voiceEnabled}
                    onChange={(e) => setVoiceEnabled(e.target.checked)}
                    className="w-6 h-6 accent-teal-700"
                  />
                </label>

                <Input
                  label={t('settings.triggers.voiceCodewordLabel')}
                  data-testid="voice-codeword-input"
                  value={voiceCodeword}
                  onChange={(e) => setVoiceCodeword(e.target.value)}
                />

                <BigButton
                  type="button"
                  variant="outline"
                  data-testid="practice-voice-btn"
                  onClick={() => togglePracticeForTrigger('voice')}
                >
                  {practiceTrigger === 'voice'
                    ? t('settings.triggers.practiceStopBtn')
                    : t('settings.triggers.practiceBtn')}
                </BigButton>
              </>
            )}
          </Card>
        </section>

        {/* Language & Appearance */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="space-y-3">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {t('settings.languageSectionTitle')}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('home.languagePrefLabel')}
            </p>
            <LanguageToggle />
          </Card>

          <Card className="space-y-3">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {t('settings.themeSectionTitle')}
            </h2>
            <Button
              type="button"
              variant="outline"
              onClick={toggleDarkMode}
            >
              {t('settings.toggleThemeBtn')}
            </Button>
          </Card>
        </section>

        {/* Quick Links */}
        <section className="space-y-4">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {t('settings.quickLinksTitle')}
          </h2>

          <div className="grid grid-cols-1 gap-4">
            <Card className="space-y-3">
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {t('settings.consentsLinkTitle')}
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {t('settings.consentsLinkBody')}
                </p>
              </div>
              <BigButton
                type="button"
                variant="primary"
                onClick={() => navigate('/consents')}
              >
                {t('home.manageConsentsBtn')}
              </BigButton>
            </Card>

            <Card className="space-y-3">
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {t('settings.circleLinkTitle')}
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {t('settings.circleLinkBody')}
                </p>
              </div>
              <BigButton
                type="button"
                variant="secondary"
                onClick={() => navigate('/circle')}
              >
                {t('home.manageCircleBtn')}
              </BigButton>
            </Card>

            <Card className="space-y-3">
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {t('settings.onboardingLinkTitle')}
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {t('settings.onboardingLinkBody')}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate('/onboarding')}
              >
                {t('home.startOnboardingBtn')}
              </Button>
            </Card>
          </div>
        </section>
      </div>
    </PageLayout>
  );
};
