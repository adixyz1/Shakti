import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bell, Moon, Sun, Wifi, WifiOff } from 'lucide-react';
import { LanguageToggle } from './LanguageToggle';
import { BottomNav, Button, ToastContainer } from './ui';
import { LoudAlarmModal } from './LoudAlarmModal';
import { useAuthStore } from '../store/authStore';
import { useTriggerSettingsStore } from '../store/triggerSettingsStore';
import { authApi } from '../lib/api';
import { getPracticeModeTarget, triggerSos } from '../lib/sos';
import {
  clearAllOfflineStateOnLogout,
  flushOfflineAlertQueue,
} from '../lib/offlineQueue';
import { PWAInstallButton } from './PWAInstallButton';
import { DemoModeBanner } from './DemoModeBanner';
import {
  isPrototypeZeroAuthMode,
  isStandaloneAndroidApk,
} from '../lib/standaloneApkApi';

const TRIPLE_TAP_WINDOW_MS = 1000;

export const PageLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, setUser, darkMode, toggleDarkMode } = useAuthStore();
  const { tripleTapEnabled, tripleTapZone } = useTriggerSettingsStore();
  const isApk = isStandaloneAndroidApk();
  const isZeroAuth = isPrototypeZeroAuthMode();

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
      await clearAllOfflineStateOnLogout();
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
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:rounded-xl focus:bg-teal-800 focus:text-white focus:font-semibold focus:shadow-lg"
      >
        Skip to main content
      </a>
      <DemoModeBanner />
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 h-16 px-3 sm:px-4 md:px-6 lg:px-8 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md flex items-center justify-between gap-2 sm:gap-4">
        {/* Left Section: Brand Logo + Primary Nav */}
        <div className="flex items-center gap-2 sm:gap-4 lg:gap-6 min-w-0 flex-1">
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
            className="shrink-0 whitespace-nowrap min-h-[44px] inline-flex items-center text-base sm:text-xl font-bold tracking-tight text-teal-800 dark:text-teal-400 hover:text-teal-900 dark:hover:text-teal-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 rounded-lg px-1.5 sm:px-2 select-none transition-colors"
          >
            {t('app.name')}
          </Link>

          {/* Zone 2: Clean text navigation links */}
          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-1 lg:gap-1.5 text-xs lg:text-sm font-medium text-slate-700 dark:text-slate-200 overflow-x-auto no-scrollbar py-1"
          >
            <Link
              to={user ? '/home' : '/'}
              className={`min-h-[38px] px-2.5 py-1.5 rounded-lg inline-flex items-center whitespace-nowrap transition-colors ${
                location.pathname === '/home' || (!user && location.pathname === '/')
                  ? 'text-teal-800 dark:text-teal-300 font-semibold bg-teal-50 dark:bg-teal-950/60'
                  : 'hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60'
              }`}
            >
              {t('nav.home')}
            </Link>
            {(user || isZeroAuth) && (
              <>
                <Link
                  to="/journeys"
                  data-testid="nav-journeys-link"
                  className={`min-h-[38px] px-2.5 py-1.5 rounded-lg inline-flex items-center whitespace-nowrap transition-colors ${
                    location.pathname === '/journeys'
                      ? 'text-teal-800 dark:text-teal-300 font-semibold bg-teal-50 dark:bg-teal-950/60'
                      : 'hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60'
                  }`}
                >
                  {t('journeys.navLink')}
                </Link>
                <Link
                  to="/reports"
                  data-testid="nav-reports-link"
                  className={`min-h-[38px] px-2.5 py-1.5 rounded-lg inline-flex items-center whitespace-nowrap transition-colors ${
                    location.pathname === '/reports'
                      ? 'text-teal-800 dark:text-teal-300 font-semibold bg-teal-50 dark:bg-teal-950/60'
                      : 'hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60'
                  }`}
                >
                  {t('reports.navLink')}
                </Link>
                <Link
                  to="/resources"
                  data-testid="nav-resources-link"
                  className={`min-h-[38px] px-2.5 py-1.5 rounded-lg inline-flex items-center whitespace-nowrap transition-colors ${
                    location.pathname === '/resources'
                      ? 'text-teal-800 dark:text-teal-300 font-semibold bg-teal-50 dark:bg-teal-950/60'
                      : 'hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60'
                  }`}
                >
                  {t('resources.navLink')}
                </Link>
                <Link
                  to="/safety-tools"
                  data-testid="nav-safety-tools-link"
                  className={`min-h-[38px] px-2.5 py-1.5 rounded-lg inline-flex items-center whitespace-nowrap transition-colors ${
                    location.pathname === '/safety-tools'
                      ? 'text-teal-800 dark:text-teal-300 font-semibold bg-teal-50 dark:bg-teal-950/60'
                      : 'hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60'
                  }`}
                >
                  {t('safetyTools.navLink', 'Safety Tools')}
                </Link>
                <Link
                  to="/circle"
                  className={`min-h-[38px] px-2.5 py-1.5 rounded-lg inline-flex items-center whitespace-nowrap transition-colors ${
                    location.pathname === '/circle'
                      ? 'text-teal-800 dark:text-teal-300 font-semibold bg-teal-50 dark:bg-teal-950/60'
                      : 'hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60'
                  }`}
                >
                  {t('nav.circle')}
                </Link>
                <Link
                  to="/consents"
                  className={`min-h-[38px] px-2.5 py-1.5 rounded-lg inline-flex items-center whitespace-nowrap transition-colors ${
                    location.pathname === '/consents'
                      ? 'text-teal-800 dark:text-teal-300 font-semibold bg-teal-50 dark:bg-teal-950/60'
                      : 'hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60'
                  }`}
                >
                  {t('nav.consents')}
                </Link>
                <Link
                  to="/settings"
                  className={`min-h-[38px] px-2.5 py-1.5 rounded-lg inline-flex items-center whitespace-nowrap transition-colors ${
                    location.pathname === '/settings'
                      ? 'text-teal-800 dark:text-teal-300 font-semibold bg-teal-50 dark:bg-teal-950/60'
                      : 'hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60'
                  }`}
                >
                  {t('nav.settings')}
                </Link>
                {(user?.role === 'responder' || isZeroAuth) && (
                  <Link
                    to="/responder"
                    data-testid="nav-responder-link"
                    className={`min-h-[38px] px-2.5 py-1.5 rounded-lg inline-flex items-center font-bold text-teal-800 dark:text-teal-300 whitespace-nowrap transition-colors ${
                      location.pathname === '/responder'
                        ? 'bg-teal-50 dark:bg-teal-950/60'
                        : 'hover:underline underline-offset-4'
                    }`}
                  >
                    {t('responderDashboard.title')}
                  </Link>
                )}
                {(user?.role === 'admin' || isZeroAuth) && (
                  <Link
                    to="/admin"
                    data-testid="nav-admin-link"
                    className={`min-h-[38px] px-2.5 py-1.5 rounded-lg inline-flex items-center font-bold text-teal-800 dark:text-teal-300 whitespace-nowrap transition-colors ${
                      location.pathname.startsWith('/admin')
                        ? 'bg-teal-50 dark:bg-teal-950/60'
                        : 'hover:underline underline-offset-4'
                    }`}
                  >
                    {t('admin.navLink')}
                  </Link>
                )}
              </>
            )}
          </nav>
        </div>

        {/* Zone 3: Primary controls + Persistent Connectivity Indicator + PWA Install */}
        <div className="shrink-0 flex items-center gap-1.5 sm:gap-2">
          {/* Connectivity indicator (only shows warning when offline, sr-only when online) */}
          <span
            role="status"
            data-testid="connectivity-indicator"
            className={
              isOnline
                ? 'sr-only'
                : 'inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-md text-amber-900 bg-amber-100 dark:bg-amber-950 dark:text-amber-200'
            }
          >
            {isOnline ? (
              'Online'
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
          {!isApk && !isZeroAuth && (
            user ? (
              <Button variant="outline" onClick={handleLogout}>
                {t('nav.signOut')}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => navigate('/login')}>
                {t('nav.signIn')}
              </Button>
            )
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 w-full max-w-5xl mx-auto px-4 md:px-8 py-8 pb-24 md:pb-12 focus:outline-none"
      >
        {children}
      </main>

      {/* Quiet Footer with 112 / 181 Disclaimer (optional alternative triple-tap zone) */}
      <footer
        data-testid="triple-tap-zone-footer"
        onClick={() => recordTapInZone('footer')}
        className="border-t border-slate-200 dark:border-slate-800 py-6 px-4 md:px-8 text-center text-xs text-slate-600 dark:text-slate-300 select-none space-y-2"
      >
        <p className="max-w-2xl mx-auto min-h-[44px] flex items-center justify-center">
          {t('app.disclaimer')}
        </p>
        <div>
          <Link
            to="/policy"
            data-testid="footer-policy-link"
            onClick={(e) => e.stopPropagation()}
            className="font-semibold text-teal-700 dark:text-teal-400 underline hover:text-teal-800"
          >
            {t('policy.navLink')}
          </Link>
        </div>
      </footer>

      <ToastContainer />
      <BottomNav />
    </div>
  );
};
