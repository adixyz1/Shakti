import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Download, Smartphone } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface ApkStatusResponse {
  available: boolean;
  downloadUrl: string;
  filename: string;
}

export const PWAInstallButton: React.FC<{
  variant?: 'header' | 'hero';
  testId?: string;
}> = ({ variant = 'header', testId }) => {
  const { t } = useTranslation();
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showFallbackModal, setShowFallbackModal] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const isStandalone =
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(display-mode: standalone)').matches) ||
      (window.navigator as unknown as { standalone?: boolean }).standalone ===
        true;
    setIsInstalled(isStandalone);

    const userAgent = (window.navigator?.userAgent || '').toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(userAgent));

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      setShowFallbackModal(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt
      );
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  if (isInstalled) {
    return null;
  }

  const triggerDirectFileDownload = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleOneClickDownload = async () => {
    if (isIOS) {
      setShowFallbackModal(true);
      return;
    }

    // 1. Check if /shakti.apk (or external VITE_ANDROID_APK_URL) is available for 1-click download
    try {
      const res = await fetch('/api/apk-status', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const data = (await res.json()) as ApkStatusResponse;
        if (data.available) {
          triggerDirectFileDownload(
            data.downloadUrl || '/shakti.apk',
            data.filename || 'shakti-android.apk'
          );
          return;
        }
      }
    } catch {
      // ignore network error and fall through
    }

    // 2. If browser supports 1-click native PWA install (Android Chrome / Desktop Chrome), fire it immediately
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setIsInstalled(true);
        setDeferredPrompt(null);
      }
      return;
    }

    // 3. Otherwise show a clean centered modal (portaled to document.body, never trapped in the navbar)
    setShowFallbackModal(true);
  };

  const resolvedTestId =
    testId || (isIOS ? 'pwa-ios-install-btn' : 'pwa-install-btn');

  const modalContent =
    showFallbackModal && typeof document !== 'undefined'
      ? createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="apk-download-modal-title"
            data-testid="android-apk-modal"
            onClick={() => setShowFallbackModal(false)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-xl space-y-4 border border-slate-200 dark:border-slate-800 text-left"
            >
              {isIOS ? (
                <>
                  <h3
                    id="apk-download-modal-title"
                    className="text-base font-bold text-slate-900 dark:text-white"
                  >
                    {t('offline.iosInstallTitle')}
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    {t('offline.iosInstallBody')}
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-xl bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 shrink-0">
                      <Smartphone className="w-5 h-5" aria-hidden="true" />
                    </div>
                    <div className="space-y-1">
                      <h3
                        id="apk-download-modal-title"
                        className="text-base font-bold text-slate-900 dark:text-white"
                      >
                        {t('offline.androidModalTitle')}
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                        {t('offline.androidModalSubtitle')}
                      </p>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800">
                    <p className="text-xs text-amber-950 dark:text-amber-200 leading-relaxed font-medium">
                      {t('offline.apkNotUploadedNotice')}
                    </p>
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {t('offline.androidChromeManualNote')}
                  </p>
                </>
              )}

              <button
                type="button"
                data-testid="close-apk-modal-btn"
                onClick={() => setShowFallbackModal(false)}
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
      {variant === 'hero' ? (
        <button
          type="button"
          data-testid={resolvedTestId}
          aria-label={t('offline.downloadApkBtn')}
          onClick={() => void handleOneClickDownload()}
          className="min-h-[48px] px-4 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 transition-colors"
        >
          <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{t('offline.downloadApkBtn')}</span>
        </button>
      ) : (
        <button
          type="button"
          data-testid={resolvedTestId}
          aria-label={t('offline.installAppBtn')}
          onClick={() => void handleOneClickDownload()}
          className="min-h-[44px] px-3 py-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 transition-colors"
        >
          <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">{t('offline.installAppBtn')}</span>
        </button>
      )}
      {modalContent}
    </>
  );
};
