import React, { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import './i18n';
import { WelcomePage } from './pages/WelcomePage';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { OnboardingPage } from './pages/OnboardingPage';
import { ConsentCenterPage } from './pages/ConsentCenterPage';
import { TrustedCirclePage } from './pages/TrustedCirclePage';
import { PublicInvitePage } from './pages/PublicInvitePage';
import { ContactAlertPage } from './pages/ContactAlertPage';
import { SettingsPage } from './pages/SettingsPage';
import { ResponderDashboardPage } from './pages/ResponderDashboardPage';
import { SafeJourneyPage } from './pages/SafeJourneyPage';
import { SafetyReportsPage } from './pages/SafetyReportsPage';
import { ResourcesPage } from './pages/ResourcesPage';
import { SafetyToolsPage } from './pages/SafetyToolsPage';
import { AdminPage } from './pages/AdminPage';
import { PolicyPage } from './pages/PolicyPage';
import { DiscreetTriggersManager } from './components/DiscreetTriggersManager';
import { useAuthStore, type UserRole } from './store/authStore';
import { useTriggerSettingsStore } from './store/triggerSettingsStore';
import { authApi } from './lib/api';
import { Spinner } from './components/ui';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

import { AccountRequiredPage, type AccountRequiredFeature } from './pages/AccountRequiredPage';
import {
  getActivePrototypeUser,
  isPrototypeZeroAuthMode,
  switchStandalonePrototypeRole,
} from './lib/standaloneApkApi';

const AccountRequiredRoute: React.FC<{
  children: React.ReactNode;
  feature?: AccountRequiredFeature;
  allowedRoles?: UserRole[];
}> = ({ children, feature = 'general', allowedRoles }) => {
  const { user, isLoading, setUser } = useAuthStore();
  const zeroAuth = isPrototypeZeroAuthMode();

  useEffect(() => {
    if (!zeroAuth) return;
    if (!user) {
      const targetRole =
        allowedRoles && allowedRoles.length > 0 ? allowedRoles[0] : 'user';
      setUser(switchStandalonePrototypeRole(targetRole));
    } else if (allowedRoles && !allowedRoles.includes(user.role)) {
      setUser(switchStandalonePrototypeRole(allowedRoles[0]));
    }
  }, [allowedRoles, setUser, user, zeroAuth]);

  if (zeroAuth) {
    return <>{children}</>;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-teal-700 dark:text-teal-400">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }

  if (!user) {
    return <AccountRequiredPage feature={feature} />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/home" replace />;
  }

  return <>{children}</>;
};

export function AppRoutes() {
  const { i18n } = useTranslation();
  const { setUser, setLoading, darkMode } = useAuthStore();
  const lowPowerDataSaverMode = useTriggerSettingsStore(
    (s) => s.lowPowerDataSaverMode
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  useEffect(() => {
    if (lowPowerDataSaverMode) {
      document.documentElement.setAttribute('data-saver', 'true');
    } else {
      document.documentElement.removeAttribute('data-saver');
    }
  }, [lowPowerDataSaverMode]);

  useEffect(() => {
    let mounted = true;
    const zeroAuth = isPrototypeZeroAuthMode();
    if (zeroAuth) {
      setUser(getActivePrototypeUser());
      setLoading(false);
    }
    (async () => {
      try {
        const me = await authApi.getMe();
        if (mounted) {
          setUser(me);
          if (me.language && me.language !== i18n.language) {
            await i18n.changeLanguage(me.language);
            window.localStorage.setItem('saathi_lang', me.language);
          }
        }
      } catch {
        if (mounted) {
          if (zeroAuth) {
            setUser(getActivePrototypeUser());
          } else {
            setUser(null);
          }
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [i18n, setLoading, setUser]);

  return (
    <>
      <DiscreetTriggersManager />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/home" element={<HomePage />} />
        <Route path="/welcome" element={<WelcomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/invite/:token" element={<PublicInvitePage />} />
        <Route path="/c/:token" element={<ContactAlertPage />} />
        <Route path="/policy" element={<PolicyPage />} />
        {/* Guest-allowed routes */}
        <Route path="/resources" element={<ResourcesPage />} />
        <Route path="/safety-tools" element={<SafetyToolsPage />} />
        <Route path="/reports" element={<SafetyReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />

        {/* Account-required routes */}
        <Route
          path="/circle"
          element={
            <AccountRequiredRoute feature="circle">
              <TrustedCirclePage />
            </AccountRequiredRoute>
          }
        />
        <Route
          path="/journeys"
          element={
            <AccountRequiredRoute feature="journeys">
              <SafeJourneyPage />
            </AccountRequiredRoute>
          }
        />
        <Route
          path="/consents"
          element={
            <AccountRequiredRoute feature="consents">
              <ConsentCenterPage />
            </AccountRequiredRoute>
          }
        />
        <Route
          path="/settings/data"
          element={
            <AccountRequiredRoute feature="data">
              <ConsentCenterPage />
            </AccountRequiredRoute>
          }
        />
        <Route
          path="/onboarding"
          element={
            <AccountRequiredRoute feature="onboarding">
              <OnboardingPage />
            </AccountRequiredRoute>
          }
        />
        <Route
          path="/responder"
          element={
            <AccountRequiredRoute feature="responder" allowedRoles={['responder']}>
              <ResponderDashboardPage />
            </AccountRequiredRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <AccountRequiredRoute feature="admin" allowedRoles={['admin']}>
              <AdminPage />
            </AccountRequiredRoute>
          }
        />
        <Route
          path="/admin/tools"
          element={
            <AccountRequiredRoute feature="admin" allowedRoles={['admin']}>
              <AdminPage />
            </AccountRequiredRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
