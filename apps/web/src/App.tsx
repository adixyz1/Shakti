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

const ProtectedRoute: React.FC<{
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}> = ({ children, allowedRoles }) => {
  const { user, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-teal-700 dark:text-teal-400">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
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
          setUser(null);
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
        <Route path="/" element={<WelcomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/invite/:token" element={<PublicInvitePage />} />
      <Route path="/c/:token" element={<ContactAlertPage />} />
      <Route path="/policy" element={<PolicyPage />} />
      <Route
        path="/home"
        element={
          <ProtectedRoute>
            <HomePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/onboarding"
        element={
          <ProtectedRoute>
            <OnboardingPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/consents"
        element={
          <ProtectedRoute>
            <ConsentCenterPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/circle"
        element={
          <ProtectedRoute>
            <TrustedCirclePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/journeys"
        element={
          <ProtectedRoute>
            <SafeJourneyPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports"
        element={
          <ProtectedRoute>
            <SafetyReportsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/resources"
        element={
          <ProtectedRoute>
            <ResourcesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/responder"
        element={
          <ProtectedRoute allowedRoles={['responder']}>
            <ResponderDashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute allowedRoles={['admin']}>
            <AdminPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/tools"
        element={
          <ProtectedRoute allowedRoles={['admin']}>
            <AdminPage />
          </ProtectedRoute>
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
