import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Moon, Sun, Wifi, WifiOff } from 'lucide-react';
import { LanguageToggle } from './LanguageToggle';
import { BottomNav, Button, ToastContainer } from './ui';
import { useAuthStore } from '../store/authStore';
import { useTriggerSettingsStore } from '../store/triggerSettingsStore';
import { authApi } from '../lib/api';
import { getPracticeModeTarget, triggerSos } from '../lib/sos';
import {
  clearOfflineEmergencyContactsCache,
  flushOfflineAlertQueue,
} from '../lib/offlineQueue';
import { PWAInstallButton } from './PWAInstallButton';

const TRIPLE_TAP_WINDOW_MS = 1000;

export const PageLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, setUser, darkMode, toggleDarkMode } = useAuthStore();
  const { tripleTapEnabled, tripleTapZone } = useTriggerSettingsStore();

  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true
  );

  const tapTimestampsRef = useRef<number[]>([]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      void flushOfflineAlertQueue();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };
    const handleFocus = () => {
      if (typeof navigator === 'undefined' || navigator.onLine !== false) {
        void flushOfflineAlertQueue();
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch {
      // ignore network error on logout
    } finally {
      await clearOfflineEmergencyContactsCache();
      setUser(null);
      navigate('/login');
    }
  };

  const recordTapInZone = (zone: 'logo' | 'footer') => {
    if (!user || !tripleTapEnabled || tripleTapZone !== zone) {
      return;
    }

    const now = Date.now();
    const recent = tapTimestampsRef.current.filter(
      (ts) => now - ts <= TRIPLE_TAP_WINDOW_MS
    );
    recent.push(now);
    tapTimestampsRef.current = recent;

    if (recent.length >= 3) {
      tapTimestampsRef.current = [];
      const isPractice = getPracticeModeTarget() !== null;
      void triggerSos('triple_tap').then(() => {
        if (!isPractice && location.pathname !== '/home') {
          navigate('/home');
        }
      });
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 h-16 px-4 md:px-8 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md flex items-center justify-between">
        {/* Zone 1: Single text element Brand wordmark (also default triple-tap zone) */}
        <Link
          to={user ? '/home' : '/'}
          data-testid="triple-tap-zone-logo"
          onClick={(e) => {
            if (user && tripleTapEnabled && tripleTapZone === 'logo') {
              recordTapInZone('logo');
              if (getPracticeModeTarget() !== null) {
                e.preventDefault();
              }
            }
          }}
          className="min-h-[56px] min-w-[56px] inline-flex items-center text-lg font-bold tracking-tight text-teal-800 dark:text-teal-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 rounded-lg px-2 select-none"
        >
          {t('app.name')}
        </Link>

        {/* Zone 2: Clean text navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300">
          <Link
            to={user ? '/home' : '/'}
            className="min-h-[44px] inline-flex items-center hover:text-slate-900 dark:hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap"
          >
            {t('nav.home')}
          </Link>
          {user && (
            <>
              <Link
                to="/circle"
                className="min-h-[44px] inline-flex items-center hover:text-slate-900 dark:hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap"
              >
                {t('nav.circle')}
              </Link>
              <Link
                to="/consents"
                className="min-h-[44px] inline-flex items-center hover:text-slate-900 dark:hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap"
              >
                {t('nav.consents')}
              </Link>
              <Link
                to="/settings"
                className="min-h-[44px] inline-flex items-center hover:text-slate-900 dark:hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap"
              >
                {t('nav.settings')}
              </Link>
            </>
          )}
        </nav>

        {/* Zone 3: Primary controls + Persistent Connectivity Indicator + PWA Install */}
        <div className="flex items-center gap-2">
          <span
            role="status"
            data-testid="connectivity-indicator"
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-md ${
              isOnline
                ? 'text-teal-800 dark:text-teal-300'
                : 'text-amber-900 bg-amber-100 dark:bg-amber-950 dark:text-amber-200'
            }`}
          >
            {isOnline ? (
              <>
                <Wifi className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">{t('offline.statusOnline')}</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t('offline.statusOffline')}</span>
              </>
            )}
          </span>
          <PWAInstallButton />
          <LanguageToggle />
          <button
            type="button"
            onClick={toggleDarkMode}
            aria-label={darkMode ? t('app.theme.light') : t('app.theme.dark')}
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          {user ? (
            <Button variant="outline" onClick={handleLogout}>
              {t('nav.signOut')}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => navigate('/login')}>
              {t('nav.signIn')}
            </Button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 md:px-8 py-8 pb-24 md:pb-12">
        {children}
      </main>

      {/* Quiet Footer with 112 / 181 Disclaimer (optional alternative triple-tap zone) */}
      <footer
        data-testid="triple-tap-zone-footer"
        onClick={() => recordTapInZone('footer')}
        className="border-t border-slate-200 dark:border-slate-800 py-6 px-4 md:px-8 text-center text-xs text-slate-500 dark:text-slate-400 select-none"
      >
        <p className="max-w-2xl mx-auto min-h-[44px] flex items-center justify-center">
          {t('app.disclaimer')}
        </p>
      </footer>

      <ToastContainer />
      <BottomNav />
    </div>
  );
};
