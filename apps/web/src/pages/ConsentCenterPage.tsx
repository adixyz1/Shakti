import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, Spinner } from '../components/ui';
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
      <div className="space-y-6 py-2">
        {/* Header */}
        <header className="space-y-2 border-b border-line pb-5">
          <div className="flex items-center gap-2">
            <svg
              aria-hidden="true"
              className="w-6 h-6 stroke-ink fill-none stroke-2 shrink-0"
              strokeLinecap="square"
              strokeLinejoin="miter"
              viewBox="0 0 24 24"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="M12 8v4" />
              <path d="M12 16h.01" />
            </svg>
            <h1 className="text-2xl md:text-3xl font-bold text-ink tracking-tight">
              {t('consents.title')}
            </h1>
          </div>
          <p className="text-sm md:text-base text-muted max-w-3xl leading-relaxed">
            {t('consents.subtitle')}
          </p>
          <div className="pt-1">
            <Link
              to="/policy"
              data-testid="consents-policy-link"
              className="text-xs font-mono font-semibold text-teal-700 underline underline-offset-4 hover:text-teal-800"
            >
              {t('privacyTools.policyLinkBtn')}
            </Link>
          </div>
        </header>

        {/* Mandatory Background Operation Limitation Notice */}
        <section
          aria-labelledby="notice-heading"
          className="bg-surface p-4 border border-line rounded-xl"
        >
          <div className="flex items-start gap-3">
            <svg
              aria-hidden="true"
              className="w-5 h-5 stroke-ink fill-none stroke-2 shrink-0 mt-0.5"
              strokeLinecap="square"
              strokeLinejoin="miter"
              viewBox="0 0 24 24"
            >
              <polygon points="12 2 2 22 22 22 12 2" />
              <line x1="12" x2="12" y1="9" y2="13" />
              <line x1="12" x2="12.01" y1="17" y2="17" />
            </svg>
            <div className="flex flex-col gap-1">
              <h2 className="text-xs font-mono uppercase tracking-wider font-semibold text-ink" id="notice-heading">
                Background Operation Limitation
              </h2>
              <p className="text-sm text-ink font-semibold">
                Notice: Shake and voice triggers work only while the app is open.
              </p>
              <p className="text-xs text-muted leading-relaxed">
                Operating system privacy constraints suspend motion sensors and live microphone loops once the display locks or the app is minimized.
              </p>
            </div>
          </div>
        </section>

        {isLoading ? (
          <div className="py-12 flex justify-center text-teal-700">
            <Spinner className="w-8 h-8" />
          </div>
        ) : (
          <>
            {/* Permission Explanation & Toggle Cards */}
            <section
              className="space-y-4"
              aria-label={t('consents.title')}
              role="group"
            >
              {ORDERED_CONSENT_TYPES.map((type) => {
                const isGranted = Boolean(current[type]);
                const isBusy = busyType === type;
                const reducedNotice = reducedModeNotices[type];
                const itemTitle = t(`consents.items.${type}.title`);

                return (
                  <article
                    key={type}
                    className="bg-surface p-4 border border-line rounded-xl flex flex-col gap-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-2 text-xs font-mono tabular-nums">
                          <span
                            className={
                              isGranted
                                ? 'font-semibold text-teal-700'
                                : 'text-muted'
                            }
                          >
                            {isGranted
                              ? t('consents.statusGranted')
                              : t('consents.statusRevoked')}
                          </span>
                          <span aria-hidden="true" className="text-line">·</span>
                          <span className="text-muted font-mono uppercase text-[11px]">
                            {type}
                          </span>
                        </div>
                        <h2 className="text-base md:text-lg font-bold text-ink truncate mt-0.5">
                          {itemTitle}
                        </h2>
                      </div>

                      {/* Paper Utility Toggle Button per stitch design */}
                      <button
                        type="button"
                        aria-pressed={isGranted}
                        disabled={isBusy}
                        onClick={() => handleToggleConsent(type, !isGranted)}
                        aria-label={`${isGranted ? t('consents.revokeBtn') : t('consents.grantBtn')} ${itemTitle}`}
                        className={`h-11 px-3 border border-line rounded-xl flex items-center gap-2 cursor-pointer select-none transition-none shrink-0 ${
                          isGranted ? 'bg-surface' : 'bg-paper'
                        } disabled:opacity-50`}
                      >
                        {isBusy ? (
                          <Spinner className="w-4 h-4 text-teal-700" />
                        ) : (
                          <>
                            <span
                              className={`text-xs font-mono font-bold ${
                                isGranted ? 'text-teal-700' : 'text-muted'
                              }`}
                            >
                              On
                            </span>
                            <span className="text-line text-[11px]">|</span>
                            <span
                              className={`text-xs font-mono font-bold ${
                                !isGranted ? 'text-ink' : 'text-muted'
                              }`}
                            >
                              Off
                            </span>
                          </>
                        )}
                      </button>
                    </div>

                    <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs md:text-sm border-t border-line pt-3">
                      <div>
                        <dt className="font-mono text-xs uppercase tracking-wider text-muted font-medium">
                          {t('consents.whatLabel')}
                        </dt>
                        <dd className="text-ink mt-0.5">
                          {t(`consents.items.${type}.what`)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-mono text-xs uppercase tracking-wider text-muted font-medium">
                          {t('consents.whyLabel')}
                        </dt>
                        <dd className="text-ink mt-0.5">
                          {t(`consents.items.${type}.why`)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-mono text-xs uppercase tracking-wider text-muted font-medium">
                          {t('consents.whoLabel')}
                        </dt>
                        <dd className="text-ink mt-0.5">
                          {t(`consents.items.${type}.who`)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-mono text-xs uppercase tracking-wider text-muted font-medium">
                          {t('consents.howLongLabel')}
                        </dt>
                        <dd className="text-ink mt-0.5">
                          {t(`consents.items.${type}.howLong`)}
                        </dd>
                      </div>
                    </dl>

                    {reducedNotice && (
                      <div
                        role="status"
                        className="bg-amber-50 border border-amber-300 p-3 rounded-xl space-y-1"
                      >
                        <p className="text-xs font-semibold text-amber-900">
                          {t('consents.reducedModeTitle', {
                            permission: itemTitle,
                          })}
                        </p>
                        <p className="text-xs text-amber-800">
                          {t('consents.reducedModeBody')}
                        </p>
                      </div>
                    )}
                  </article>
                );
              })}
            </section>

            {/* Append-Only Consent Ledger History */}
            <section className="space-y-3 pt-4">
              <div className="space-y-0.5">
                <h2 className="text-base font-bold text-ink">
                  {t('consents.historyTitle')}
                </h2>
                <p className="text-xs font-mono text-muted">
                  {t('consents.historySubtitle')}
                </p>
              </div>

              <Card className="divide-y divide-line p-0 bg-surface border border-line">
                {history.length === 0 ? (
                  <p className="text-xs font-mono text-muted p-4">
                    {t('consents.historyEmpty')}
                  </p>
                ) : (
                  history.map((entry) => (
                    <div
                      key={entry.id}
                      className="p-3.5 flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-bold ${
                            entry.granted
                              ? 'text-teal-700'
                              : 'text-crimson-800'
                          }`}
                        >
                          {entry.granted
                            ? t('consents.ledgerGranted')
                            : t('consents.ledgerRevoked')}
                        </span>
                        <span aria-hidden="true" className="text-line">·</span>
                        <span className="text-ink font-semibold">
                          {entry.type}
                        </span>
                        <span aria-hidden="true" className="text-line">·</span>
                        <span className="text-muted">
                          {t('consents.ledgerSource', { source: entry.source })}
                        </span>
                      </div>
                      <time
                        dateTime={entry.created_at}
                        className="text-muted"
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
