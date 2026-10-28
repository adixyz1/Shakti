import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bell } from 'lucide-react';
import { BigButton, Button, Card } from '../components/ui';
import { PageLayout } from '../components/PageLayout';
import { LoudAlarmModal } from '../components/LoudAlarmModal';
import { PWAInstallButton } from '../components/PWAInstallButton';

export const WelcomePage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [showLoudAlarm, setShowLoudAlarm] = useState(false);

  return (
    <PageLayout>
      <div className="space-y-10 py-4 md:py-8 text-ink dark:text-slate-100">
        {/* Hero Section */}
        <section className="max-w-3xl space-y-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-teal-700 rounded-full shrink-0" />
            <p className="text-xs font-mono uppercase tracking-wider text-muted dark:text-slate-300 font-semibold">
              {t('welcome.kicker')}
            </p>
          </div>
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-ink dark:text-slate-100 leading-tight text-balance">
            {t('welcome.title')}
          </h1>
          <p className="text-sm md:text-base text-muted dark:text-slate-300 leading-relaxed max-w-2xl">
            {t('welcome.subtitle')}
          </p>
          <div className="pt-2 flex flex-col sm:flex-row flex-wrap gap-3 max-w-xl">
            <BigButton variant="primary" onClick={() => navigate('/login')}>
              {t('welcome.ctaPrimary')}
            </BigButton>
            <PWAInstallButton
              variant="hero"
              testId="welcome-download-apk-btn"
            />
            <Button
              type="button"
              variant="outline"
              data-testid="welcome-loud-alarm-btn"
              onClick={() => setShowLoudAlarm(true)}
              className="min-h-[48px] px-4 rounded-xl border border-amber-400 text-amber-900 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-950/40 inline-flex items-center justify-center gap-2 font-semibold"
            >
              <Bell className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <span>{t('welcome.loudAlarmBtn')}</span>
            </Button>
          </div>

          <div className="p-4 bg-surface dark:bg-slate-900 border border-line dark:border-slate-800 rounded-xl max-w-xl shadow-xs">
            <p className="text-xs text-muted dark:text-slate-300 leading-relaxed">
              {t('welcome.helplineNotice')}
            </p>
          </div>
        </section>

        {/* Core Constraints / Pillars */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-line dark:border-slate-800">
          <Card className="space-y-2 border border-line dark:border-slate-800 bg-surface dark:bg-slate-900 rounded-2xl">
            <h2 className="text-xs font-mono uppercase tracking-wider font-bold text-ink dark:text-slate-100">
              01. {t('welcome.pillars.consentTitle')}
            </h2>
            <p className="text-xs md:text-sm text-muted dark:text-slate-300 leading-relaxed">
              {t('welcome.pillars.consentBody')}
            </p>
          </Card>

          <Card className="space-y-2 border border-line dark:border-slate-800 bg-surface dark:bg-slate-900 rounded-2xl">
            <h2 className="text-xs font-mono uppercase tracking-wider font-bold text-ink dark:text-slate-100">
              02. {t('welcome.pillars.noTrackingTitle')}
            </h2>
            <p className="text-xs md:text-sm text-muted dark:text-slate-300 leading-relaxed">
              {t('welcome.pillars.noTrackingBody')}
            </p>
          </Card>

          <Card className="space-y-2 border border-line dark:border-slate-800 bg-surface dark:bg-slate-900 rounded-2xl">
            <h2 className="text-xs font-mono uppercase tracking-wider font-bold text-ink dark:text-slate-100">
              03. {t('welcome.pillars.resilientTitle')}
            </h2>
            <p className="text-xs md:text-sm text-muted dark:text-slate-300 leading-relaxed">
              {t('welcome.pillars.resilientBody')}
            </p>
          </Card>
        </section>
      </div>

      <LoudAlarmModal
        isOpen={showLoudAlarm}
        onClose={() => setShowLoudAlarm(false)}
      />
    </PageLayout>
  );
};
