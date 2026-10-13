import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Card } from './ui';
import { resourcesPulseApi } from '../lib/api';
import { useAuthStore } from '../store/authStore';

const PULSE_DISMISSED_STORAGE_KEY = 'saathi_pulse_dismissed_at';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const SafetyPulseCard: React.FC<{
  hasActiveAlert: boolean;
  isDisguised: boolean;
}> = ({ hasActiveAlert, isDisguised }) => {
  const { t } = useTranslation();
  const addToast = useAuthStore((s) => s.addToast);

  const [shouldShow, setShouldShow] = useState(false);
  const [safetyScore, setSafetyScore] = useState<number>(4);
  const [avoidedGoingSomewhere, setAvoidedGoingSomewhere] =
    useState<boolean>(false);
  const [anonymous, setAnonymous] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (hasActiveAlert || isDisguised) {
      return;
    }

    // Check if locally dismissed within the past 7 days
    try {
      const dismissedRaw = window.localStorage.getItem(
        PULSE_DISMISSED_STORAGE_KEY
      );
      if (dismissedRaw) {
        const dismissedMs = Number(dismissedRaw);
        if (Number.isFinite(dismissedMs) && Date.now() - dismissedMs < WEEK_MS) {
          setShouldShow(false);
          return;
        }
      }
    } catch {
      // ignore storage errors
    }

    let mounted = true;
    (async () => {
      try {
        const status = await resourcesPulseApi.getPulseStatus();
        if (mounted) {
          setShouldShow(Boolean(status.should_prompt));
        }
      } catch {
        if (mounted) {
          setShouldShow(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [hasActiveAlert, isDisguised]);

  // Critical rule: never shown during an active alert or while disguise mode is on
  if (hasActiveAlert || isDisguised || !shouldShow) {
    return null;
  }

  const handleDismiss = () => {
    try {
      window.localStorage.setItem(
        PULSE_DISMISSED_STORAGE_KEY,
        String(Date.now())
      );
    } catch {
      // ignore storage errors
    }
    setShouldShow(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await resourcesPulseApi.submitPulse({
        safety_score: safetyScore,
        avoided_going_somewhere: avoidedGoingSomewhere,
        anonymous,
      });
      try {
        window.localStorage.setItem(
          PULSE_DISMISSED_STORAGE_KEY,
          String(Date.now())
        );
      } catch {
        // ignore
      }
      setShouldShow(false);
      addToast(t('pulse.thankYouToast'));
    } catch {
      setShouldShow(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card
      data-testid="safety-pulse-card"
      className="p-4 text-left border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            {t('pulse.title')}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('pulse.subtitle')}
          </p>
        </div>
        <button
          type="button"
          data-testid="pulse-dismiss-btn"
          aria-label={t('pulse.skipBtn')}
          onClick={handleDismiss}
          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Question 1: How safe did you feel traveling this week? (1-5) */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
            {t('pulse.q1Label')}
          </p>
          <div className="grid grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5].map((score) => {
              const selected = safetyScore === score;
              return (
                <button
                  key={score}
                  type="button"
                  data-testid={`pulse-score-${score}`}
                  aria-pressed={selected}
                  onClick={() => setSafetyScore(score)}
                  className={`min-h-[44px] rounded-xl font-bold text-sm border transition-colors ${
                    selected
                      ? 'bg-teal-800 text-white border-teal-800 dark:bg-teal-700 dark:border-teal-700'
                      : 'bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700'
                  }`}
                >
                  {score}
                </button>
              );
            })}
          </div>
        </div>

        {/* Question 2: Did you avoid going somewhere because of safety? (Yes/No) */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
            {t('pulse.q2Label')}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              data-testid="pulse-avoided-yes"
              aria-pressed={avoidedGoingSomewhere === true}
              onClick={() => setAvoidedGoingSomewhere(true)}
              className={`min-h-[44px] rounded-xl font-semibold text-xs border transition-colors ${
                avoidedGoingSomewhere
                  ? 'bg-teal-800 text-white border-teal-800 dark:bg-teal-700 dark:border-teal-700'
                  : 'bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700'
              }`}
            >
              {t('pulse.yesBtn')}
            </button>
            <button
              type="button"
              data-testid="pulse-avoided-no"
              aria-pressed={avoidedGoingSomewhere === false}
              onClick={() => setAvoidedGoingSomewhere(false)}
              className={`min-h-[44px] rounded-xl font-semibold text-xs border transition-colors ${
                !avoidedGoingSomewhere
                  ? 'bg-teal-800 text-white border-teal-800 dark:bg-teal-700 dark:border-teal-700'
                  : 'bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700'
              }`}
            >
              {t('pulse.noBtn')}
            </button>
          </div>
        </div>

        {/* Anonymous toggle */}
        <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            data-testid="pulse-anonymous-checkbox"
            checked={anonymous}
            onChange={(e) => setAnonymous(e.target.checked)}
            className="w-4 h-4 rounded accent-teal-700"
          />
          <span>{t('pulse.anonymousLabel')}</span>
        </label>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            data-testid="pulse-skip-btn"
            onClick={handleDismiss}
            className="min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {t('pulse.skipBtn')}
          </button>
          <button
            type="submit"
            data-testid="pulse-submit-btn"
            disabled={isSubmitting}
            className="min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold bg-teal-800 hover:bg-teal-900 text-white dark:bg-teal-700"
          >
            {t('pulse.submitBtn')}
          </button>
        </div>
      </form>
    </Card>
  );
};
