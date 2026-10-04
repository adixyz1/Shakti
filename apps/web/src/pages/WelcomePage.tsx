import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BigButton, Card } from '../components/ui';
import { PageLayout } from '../components/PageLayout';

export const WelcomePage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <PageLayout>
      <div className="space-y-12 py-4 md:py-10">
        {/* Hero Section */}
        <section className="max-w-3xl space-y-6">
          <p className="text-xs font-medium text-teal-700 dark:text-teal-400">
            {t('welcome.kicker')}
          </p>
          <h1 className="text-3xl md:text-5xl font-semibold tracking-tight text-slate-900 dark:text-slate-50 leading-tight text-balance">
            {t('welcome.title')}
          </h1>
          <p className="text-base md:text-lg text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
            {t('welcome.subtitle')}
          </p>

          <div className="pt-2 max-w-sm">
            <BigButton onClick={() => navigate('/login')}>
              {t('welcome.ctaPrimary')}
            </BigButton>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400 pt-2">
            {t('welcome.helplineNotice')}
          </p>
        </section>

        {/* Core Constraints / Pillars */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="space-y-2">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              01. {t('welcome.pillars.consentTitle')}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {t('welcome.pillars.consentBody')}
            </p>
          </Card>

          <Card className="space-y-2">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              02. {t('welcome.pillars.noTrackingTitle')}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {t('welcome.pillars.noTrackingBody')}
            </p>
          </Card>

          <Card className="space-y-2">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              03. {t('welcome.pillars.resilientTitle')}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {t('welcome.pillars.resilientBody')}
            </p>
          </Card>
        </section>
      </div>
    </PageLayout>
  );
};
