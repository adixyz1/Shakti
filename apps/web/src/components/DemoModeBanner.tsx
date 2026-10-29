import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';
import { useDemoStore } from '../store/demoStore';
import { useAuthStore, type UserRole } from '../store/authStore';
import { authApi } from '../lib/api';
import {
  isPrototypeZeroAuthMode,
  isStandaloneAndroidApk,
  switchStandalonePrototypeRole,
} from '../lib/standaloneApkApi';

export const DemoModeBanner: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { checked, demoMode, status, checkDemoMode } = useDemoStore();
  const { user, setUser, addToast } = useAuthStore();
  const isZeroAuth = isPrototypeZeroAuthMode();
  const isApk = isStandaloneAndroidApk();

  useEffect(() => {
    if (!checked) {
      void checkDemoMode();
    }
  }, [checked, checkDemoMode]);

  if (!demoMode && !isZeroAuth) {
    return null;
  }

  const smsName = status?.providers?.sms?.name || 'MockSmsProvider';
  const pushName = status?.providers?.push?.name || 'MockPushProvider';
  const gwName =
    status?.providers?.gateway_112?.name || 'MockEmergencyGateway';

  const handleRoleSwitch = async (role: UserRole) => {
    const localUser = switchStandalonePrototypeRole(role);
    setUser(localUser);
    try {
      const serverUser = await authApi.getMe();
      setUser(serverUser);
    } catch {
      // keep localUser
    }
    addToast(`Switched Demo Account to ${localUser.name} (${role.toUpperCase()})`, 'info');
    if (role === 'responder') {
      navigate('/responder');
    } else if (role === 'admin') {
      navigate('/admin');
    } else {
      navigate('/home');
    }
  };

  return (
    <div
      role="region"
      aria-label="Demo mode notice"
      data-testid="demo-mode-banner"
      className="w-full bg-amber-100 dark:bg-amber-950 border-b border-amber-300 dark:border-amber-800 px-3 sm:px-4 py-1.5 text-xs font-bold text-amber-950 dark:text-amber-100 flex flex-wrap items-center justify-between gap-2 z-40"
    >
      <div className="inline-flex items-center gap-1.5">
        <ShieldAlert className="w-4 h-4 shrink-0 text-amber-800 dark:text-amber-300" />
        <span data-testid="demo-mode-banner-text">
          {t('demo.bannerText', 'DEMO MODE: no real alerts are sent')}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {isZeroAuth && (
          <div
            aria-label="Prototype role switcher"
            className="inline-flex items-center gap-1 text-[11px]"
          >
            <span className="text-amber-900 dark:text-amber-200 mr-0.5">
              Demo Account:
            </span>
            {(['user', 'responder', 'admin'] as UserRole[]).map((role) => {
              const active = (user?.role || 'user') === role;
              const label =
                role === 'user'
                  ? '👩 User (Aarohi)'
                  : role === 'responder'
                    ? '🚓 Responder (Kavita)'
                    : '📊 Admin (Meera)';
              return (
                <button
                  key={role}
                  type="button"
                  data-testid={`switch-demo-role-${role}`}
                  onClick={() => void handleRoleSwitch(role)}
                  className={`px-2 py-0.5 rounded-md font-semibold transition-colors cursor-pointer ${
                    active
                      ? 'bg-teal-800 text-white shadow-2xs'
                      : 'bg-amber-200/80 dark:bg-amber-900 text-amber-950 dark:text-amber-100 hover:bg-amber-300 dark:hover:bg-amber-800'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {!isApk && (
          <div
            data-testid="demo-mode-mock-provider-labels"
            className="hidden xl:inline-flex flex-wrap items-center gap-2 font-mono text-[11px] text-amber-900 dark:text-amber-200"
          >
            <span data-testid="demo-provider-sms">SMS: {smsName} [MOCK]</span>
            <span aria-hidden="true">·</span>
            <span data-testid="demo-provider-push">Push: {pushName} [MOCK]</span>
            <span aria-hidden="true">·</span>
            <span data-testid="demo-provider-gateway">112: {gwName} [MOCK]</span>
          </div>
        )}
      </div>
    </div>
  );
};
