import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BigButton, Button, Card, Spinner } from '../components/ui';
import { PageLayout } from '../components/PageLayout';
import {
  consentsApi,
  type ConsentLedgerEntry,
  type ConsentStateMap,
  type ConsentType,
  ApiError,
} from '../lib/api';
import { clearOfflineEmergencyContactsCache } from '../lib/offlineQueue';
import { useAuthStore } from '../store/authStore';

const ORDERED_CONSENT_TYPES: ConsentType[] = [
  'data_processing',
  'location',
  'notifications',
  'microphone',
  'camera',
];

/**
 * Browser permission prompts (location, notifications) are triggered ONLY from this Consent Center
 * after presenting the full explanation (what, why, who, how long) to the user.
 */
async function requestBrowserPermissionIfApplicable(
  type: ConsentType
): Promise<{ browserAllowed: boolean; reducedModeReason?: string }> {
  if (typeof window === 'undefined') {
    return { browserAllowed: true };
  }

  if (type === 'location') {
    if (!('geolocation' in navigator) || !navigator.geolocation) {
      return {
        browserAllowed: false,
        reducedModeReason: 'Geolocation API is unavailable in this browser.',
      };
    }
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        () => resolve({ browserAllowed: true }),
        () =>
          resolve({
            browserAllowed: false,
            reducedModeReason: 'Browser location permission was declined.',
          }),
        { timeout: 4000 }
      );
    });
  }

  if (type === 'notifications') {
    if (!('Notification' in window) || !window.Notification) {
      return {
        browserAllowed: false,
        reducedModeReason: 'Notifications API is unavailable in this browser.',
      };
    }
    try {
      const result = await window.Notification.requestPermission();
      if (result === 'granted') {
        return { browserAllowed: true };
      }
      return {
        browserAllowed: false,
        reducedModeReason: `Browser notification permission is ${result}.`,
      };
    } catch {
      return {
        browserAllowed: false,
        reducedModeReason: 'Notification permission request was blocked.',
      };
    }
  }

  return { browserAllowed: true };
}

export const ConsentCenterPage: React.FC = () => {
  const { t } = useTranslation();
  const { addToast } = useAuthStore();

  const [current, setCurrent] = useState<ConsentStateMap>({
    data_processing: false,
    location: false,
    notifications: false,
    microphone: false,
    camera: false,
  });
  const [history, setHistory] = useState<ConsentLedgerEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyType, setBusyType] = useState<ConsentType | null>(null);
  const [reducedModeNotices, setReducedModeNotices] = useState<
    Partial<Record<ConsentType, string>>
  >({});

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await consentsApi.getConsents();
        if (mounted) {
          setCurrent(res.current);
          setHistory(res.history);
        }
      } catch (err) {
        if (mounted) {
          addToast(
            err instanceof ApiError ? err.message : 'Failed to load consents',
            'error'
          );
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [addToast]);

  const handleToggleConsent = async (type: ConsentType, nextGranted: boolean) => {
    setBusyType(type);
    try {
      if (nextGranted && (type === 'location' || type === 'notifications')) {
        const permCheck = await requestBrowserPermissionIfApplicable(type);
        if (!permCheck.browserAllowed) {
          setReducedModeNotices((prev) => ({
            ...prev,
            [type]: permCheck.reducedModeReason || 'Reduced mode active',
          }));
        } else {
          setReducedModeNotices((prev) => {
            const copy = { ...prev };
            delete copy[type];
            return copy;
          });
        }
      }

      const res = await consentsApi.postConsent({
        type,
        granted: nextGranted,
        source: 'consent_center',
      });
      if (type === 'data_processing' && !nextGranted) {
        await clearOfflineEmergencyContactsCache();
      }
      setCurrent(res.current);
      setHistory(res.history);
    } catch (err) {
      addToast(
        err instanceof ApiError ? err.message : 'Failed to update consent',
        'error'
      );
    } finally {
      setBusyType(null);
    }
  };

  return (
    <PageLayout>
      <div className="space-y-8 py-4">
        <header className="space-y-2 border-b border-slate-200 dark:border-slate-800 pb-6">
          <h1 className="text-2xl md:text-3xl font-semibold text-slate-900 dark:text-slate-50">
            {t('consents.title')}
          </h1>
          <p className="text-sm md:text-base text-slate-600 dark:text-slate-300 max-w-3xl leading-relaxed">
            {t('consents.subtitle')}
          </p>
          <div className="pt-1">
            <Link
              to="/policy"
              data-testid="consents-policy-link"
              className="text-sm font-semibold text-teal-800 dark:text-teal-300 underline underline-offset-4"
            >
              {t('privacyTools.policyLinkBtn')}
            </Link>
          </div>
        </header>

        {isLoading ? (
          <div className="py-12 flex justify-center text-teal-700 dark:text-teal-400">
            <Spinner className="w-8 h-8" />
          </div>
        ) : (
          <>
            {/* Permission Explanation & Toggle Cards */}
            <section className="space-y-4" aria-label={t('consents.title')}>
              {ORDERED_CONSENT_TYPES.map((type) => {
                const isGranted = Boolean(current[type]);
                const isBusy = busyType === type;
                const reducedNotice = reducedModeNotices[type];
                const itemTitle = t(`consents.items.${type}.title`);

                return (
                  <Card key={type} className="space-y-4">
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs font-mono tabular-nums">
                          <span
                            className={
                              isGranted
                                ? 'font-semibold text-teal-700 dark:text-teal-400'
                                : 'text-slate-500 dark:text-slate-400'
                            }
                          >
                            {isGranted
                              ? t('consents.statusGranted')
                              : t('consents.statusRevoked')}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="text-slate-500 dark:text-slate-400">
                            {type}
                          </span>
                        </div>
                        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                          {itemTitle}
                        </h2>
                      </div>

                      <div className="shrink-0">
                        {isGranted ? (
                          <Button
                            type="button"
                            variant="outline"
                            isLoading={isBusy}
                            onClick={() => handleToggleConsent(type, false)}
                            aria-label={`${t('consents.revokeBtn')} ${itemTitle}`}
                          >
                            {t('consents.revokeBtn')}
                          </Button>
                        ) : (
                          <BigButton
                            type="button"
                            variant="primary"
                            isLoading={isBusy}
                            className="md:w-auto"
                            onClick={() => handleToggleConsent(type, true)}
                            aria-label={`${t('consents.grantBtn')} ${itemTitle}`}
                          >
                            {t('consents.grantBtn')}
                          </BigButton>
                        )}
                      </div>
                    </div>

                    <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm border-t border-slate-100 dark:border-slate-800 pt-4">
                      <div>
                        <dt className="font-semibold text-slate-800 dark:text-slate-200">
                          {t('consents.whatLabel')}
                        </dt>
                        <dd className="text-slate-600 dark:text-slate-300">
                          {t(`consents.items.${type}.what`)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-slate-800 dark:text-slate-200">
                          {t('consents.whyLabel')}
                        </dt>
                        <dd className="text-slate-600 dark:text-slate-300">
                          {t(`consents.items.${type}.why`)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-slate-800 dark:text-slate-200">
                          {t('consents.whoLabel')}
                        </dt>
                        <dd className="text-slate-600 dark:text-slate-300">
                          {t(`consents.items.${type}.who`)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-slate-800 dark:text-slate-200">
                          {t('consents.howLongLabel')}
                        </dt>
                        <dd className="text-slate-600 dark:text-slate-300">
                          {t(`consents.items.${type}.howLong`)}
                        </dd>
                      </div>
                    </dl>

                    {reducedNotice && (
                      <div
                        role="status"
                        className="rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 p-4 space-y-1"
                      >
                        <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                          {t('consents.reducedModeTitle', {
                            permission: itemTitle,
                          })}
                        </p>
                        <p className="text-xs text-amber-800 dark:text-amber-300">
                          {t('consents.reducedModeBody')}
                        </p>
                      </div>
                    )}
                  </Card>
                );
              })}
            </section>

            {/* Append-Only Consent Ledger History */}
            <section className="space-y-4 pt-4">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {t('consents.historyTitle')}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('consents.historySubtitle')}
                </p>
              </div>

              <Card className="divide-y divide-slate-100 dark:divide-slate-800">
                {history.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400 py-2">
                    {t('consents.historyEmpty')}
                  </p>
                ) : (
                  history.map((entry) => (
                    <div
                      key={entry.id}
                      className="py-3 first:pt-0 last:pb-0 flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={
                            entry.granted
                              ? 'font-bold text-teal-700 dark:text-teal-400'
                              : 'font-bold text-rose-700 dark:text-rose-400'
                          }
                        >
                          {entry.granted
                            ? t('consents.ledgerGranted')
                            : t('consents.ledgerRevoked')}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="text-slate-900 dark:text-slate-100 font-semibold">
                          {entry.type}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="text-slate-500 dark:text-slate-400">
                          {t('consents.ledgerSource', { source: entry.source })}
                        </span>
                      </div>
                      <time
                        dateTime={entry.created_at}
                        className="text-slate-500 dark:text-slate-400"
                      >
                        {new Date(entry.created_at).toLocaleString()}
                      </time>
                    </div>
                  ))
                )}
              </Card>
            </section>
          </>
        )}
      </div>
    </PageLayout>
  );
};
