import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';
import { useDemoStore } from '../store/demoStore';

export const DemoModeBanner: React.FC = () => {
  const { t } = useTranslation();
  const { checked, demoMode, status, checkDemoMode } = useDemoStore();

  useEffect(() => {
    if (!checked) {
      void checkDemoMode();
    }
  }, [checked, checkDemoMode]);

  if (!demoMode) {
    return null;
  }

  const smsName = status?.providers?.sms?.name || 'MockSmsProvider';
  const pushName = status?.providers?.push?.name || 'MockPushProvider';
  const gwName =
    status?.providers?.gateway_112?.name || 'MockEmergencyGateway';

  return (
    <div
      role="region"
      aria-label="Demo mode notice"
      data-testid="demo-mode-banner"
      className="w-full bg-amber-100 dark:bg-amber-950 border-b border-amber-300 dark:border-amber-800 px-4 py-2 text-xs font-bold text-amber-950 dark:text-amber-100 flex flex-wrap items-center justify-between gap-2 z-40"
    >
      <div className="inline-flex items-center gap-2">
        <ShieldAlert className="w-4 h-4 shrink-0 text-amber-800 dark:text-amber-300" />
        <span data-testid="demo-mode-banner-text">
          {t('demo.bannerText', 'DEMO MODE: no real alerts are sent')}
        </span>
      </div>

      <div
        data-testid="demo-mode-mock-provider-labels"
        className="inline-flex flex-wrap items-center gap-2 font-mono text-[11px] text-amber-900 dark:text-amber-200"
      >
        <span data-testid="demo-provider-sms">SMS: {smsName} [MOCK]</span>
        <span aria-hidden="true">·</span>
        <span data-testid="demo-provider-push">Push: {pushName} [MOCK]</span>
        <span aria-hidden="true">·</span>
        <span data-testid="demo-provider-gateway">112: {gwName} [MOCK]</span>
      </div>
    </div>
  );
};
