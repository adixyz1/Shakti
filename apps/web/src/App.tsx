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
import { SettingsPage } from './pages/SettingsPage';
import { DiscreetTriggersManager } from './components/DiscreetTriggersManager';
import { useAuthStore } from './store/authStore';
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

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
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

  return <>{children}</>;
};

export function AppRoutes() {
  const { i18n } = useTranslation();
  const { setUser, setLoading, darkMode } = useAuthStore();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

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
        path="/settings"
        element={
          <ProtectedRoute>
            <SettingsPage />
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
