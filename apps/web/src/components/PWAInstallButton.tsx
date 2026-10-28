import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { isStandaloneAndroidApk } from '../lib/standaloneApkApi';

export const PWAInstallButton: React.FC<{
  variant?: 'header' | 'hero';
  testId?: string;
}> = ({ variant = 'header', testId }) => {
  const { t } = useTranslation();
  const [isInstalled, setIsInstalled] = useState(() => isStandaloneAndroidApk());
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSModal, setShowIOSModal] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const isStandalone =
      isStandaloneAndroidApk() ||
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(display-mode: standalone)').matches) ||
      (window.navigator as unknown as { standalone?: boolean }).standalone ===
        true;
    setIsInstalled(isStandalone);

    const userAgent = (window.navigator?.userAgent || '').toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(userAgent));

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setShowIOSModal(false);
    };

    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  if (isInstalled || isStandaloneAndroidApk()) {
    return null;
  }

  const resolvedTestId =
    testId || (isIOS ? 'pwa-ios-install-btn' : 'pwa-install-btn');

  if (isIOS) {
    const iosModal =
      showIOSModal && typeof document !== 'undefined'
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="ios-install-modal-title"
              data-testid="android-apk-modal"
              onClick={() => setShowIOSModal(false)}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-xl space-y-4 border border-slate-200 dark:border-slate-800 text-left"
              >
                <h3
                  id="ios-install-modal-title"
                  className="text-base font-bold text-slate-900 dark:text-white"
                >
                  {t('offline.iosInstallTitle')}
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  {t('offline.iosInstallBody')}
                </p>
                <button
                  type="button"
                  data-testid="close-apk-modal-btn"
                  onClick={() => setShowIOSModal(false)}
                  className="min-h-[44px] w-full rounded-xl bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                >
                  {t('home.closeBtn')}
                </button>
              </div>
            </div>,
            document.body
          )
        : null;

    return (
      <>
        <button
          type="button"
          data-testid={resolvedTestId}
          aria-label={
            variant === 'hero'
              ? t('offline.downloadApkBtn')
              : t('offline.installAppBtn')
          }
          onClick={() => setShowIOSModal(true)}
          className={
            variant === 'hero'
              ? 'min-h-[48px] px-4 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 transition-colors'
              : 'min-h-[44px] px-3 py-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 transition-colors'
          }
        >
          <Download
            className={
              variant === 'hero' ? 'w-4 h-4 shrink-0' : 'w-3.5 h-3.5 shrink-0'
            }
            aria-hidden="true"
          />
          <span className={variant === 'hero' ? '' : 'hidden sm:inline'}>
            {variant === 'hero'
              ? t('offline.downloadApkBtn')
              : t('offline.installAppBtn')}
          </span>
        </button>
        {iosModal}
      </>
    );
  }

  // Direct synchronous 1-click download link to /shakti.apk
  return (
    <a
      href="/shakti.apk"
      download="shakti-android.apk"
      data-testid={resolvedTestId}
      aria-label={
        variant === 'hero'
          ? t('offline.downloadApkBtn')
          : t('offline.installAppBtn')
      }
      className={
        variant === 'hero'
          ? 'min-h-[48px] px-4 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 transition-colors no-underline'
          : 'min-h-[44px] px-3 py-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 transition-colors no-underline'
      }
    >
      <Download
        className={
          variant === 'hero' ? 'w-4 h-4 shrink-0' : 'w-3.5 h-3.5 shrink-0'
        }
        aria-hidden="true"
      />
      <span className={variant === 'hero' ? '' : 'hidden sm:inline'}>
        {variant === 'hero'
          ? t('offline.downloadApkBtn')
          : t('offline.installAppBtn')}
      </span>
    </a>
  );
};
