import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HeartHandshake, PhoneCall } from 'lucide-react';
import { Card } from './ui';
import { resourcesPulseApi } from '../lib/api';
import { useTriggerSettingsStore } from '../store/triggerSettingsStore';

export const LOCAL_SUPPORT_HELPLINES = {
  womenHelpline: '181',
  emergency: '112',
} as const;

export interface ClosedAlertSupportCardProps {
  forceOffline?: boolean;
  isDisguised?: boolean;
}

export const ClosedAlertSupportCard: React.FC<ClosedAlertSupportCardProps> = ({
  forceOffline,
  isDisguised: propIsDisguised,
}) => {
  const { t } = useTranslation();
  const { disguiseEnabled, disguiseUnlockedSession } = useTriggerSettingsStore();
  const isDisguised = propIsDisguised ?? Boolean(disguiseEnabled && !disguiseUnlockedSession);

  const [isOffline, setIsOffline] = useState<boolean>(() => {
    if (forceOffline !== undefined) return forceOffline;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
    return false;
  });

  useEffect(() => {
    if (forceOffline !== undefined) {
      setIsOffline(forceOffline);
      return;
    }

    let cancelled = false;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsOffline(true);
      return;
    }

    // Probe resources API
    resourcesPulseApi
      .listResources()
      .then(() => {
        if (!cancelled) setIsOffline(false);
      })
      .catch(() => {
        if (!cancelled) setIsOffline(true);
      });

    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => {
      resourcesPulseApi
        .listResources()
        .then(() => {
          if (!cancelled) setIsOffline(false);
        })
        .catch(() => {
          if (!cancelled) setIsOffline(true);
        });
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      cancelled = true;
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [forceOffline]);

  // Do not show the card while in disguise mode
  if (isDisguised) {
    return null;
  }

  return (
    <Card
      data-testid="closed-alert-support-card"
      className="p-4 sm:p-5 border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-2xl space-y-3 text-left shadow-sm"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <HeartHandshake
            className="w-5 h-5 text-teal-800 dark:text-teal-400 shrink-0"
            aria-hidden="true"
          />
          <span
            data-testid="support-card-prompt"
            className="text-sm font-semibold text-slate-900 dark:text-slate-100"
          >
            {t('supportOptions.prompt')}{' '}
          </span>
        </div>

        <Link
          to="/resources"
          data-testid="support-options-link"
          className="min-h-[56px] px-5 py-3 rounded-xl font-bold text-sm bg-teal-800 hover:bg-teal-900 text-white dark:bg-teal-700 dark:hover:bg-teal-600 inline-flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
        >
          {t('supportOptions.cta')}
        </Link>
      </div>

      {isOffline && (
        <div
          data-testid="offline-support-fallback"
          className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2.5"
        >
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('supportOptions.offlineNotice')}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <a
              href={`tel:${LOCAL_SUPPORT_HELPLINES.womenHelpline}`}
              data-testid="support-call-181"
              className="min-h-[56px] px-4 py-3 rounded-xl font-bold text-sm bg-slate-50 dark:bg-slate-800 border border-teal-800 text-teal-800 dark:text-teal-300 dark:border-teal-500 hover:bg-slate-100 dark:hover:bg-slate-700 inline-flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
            >
              <PhoneCall className="w-4 h-4" aria-hidden="true" />
              {t('supportOptions.call181')}
            </a>
            <a
              href={`tel:${LOCAL_SUPPORT_HELPLINES.emergency}`}
              data-testid="support-call-112"
              className="min-h-[56px] px-4 py-3 rounded-xl font-bold text-sm bg-rose-700 text-white hover:bg-rose-800 inline-flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/50"
            >
              <PhoneCall className="w-4 h-4" aria-hidden="true" />
              {t('supportOptions.call112')}
            </a>
          </div>
        </div>
      )}
    </Card>
  );
};
