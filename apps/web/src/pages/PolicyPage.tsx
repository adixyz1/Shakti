import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Lock, Clock, Trash2, AlertTriangle } from 'lucide-react';
import { Card } from '../components/ui';
import { PageLayout } from '../components/PageLayout';

export const PolicyPage: React.FC = () => {
  const { t } = useTranslation();

  return (
    <PageLayout>
      <div className="max-w-3xl mx-auto space-y-6 py-4" data-testid="policy-page">
        <header className="space-y-2 border-b border-slate-200 dark:border-slate-800 pb-6">
          <h1 className="text-2xl md:text-3xl font-semibold text-slate-900 dark:text-slate-50">
            {t('policy.title')}
          </h1>
          <p className="text-sm md:text-base text-slate-600 dark:text-slate-300 leading-relaxed">
            {t('policy.subtitle')}
          </p>
        </header>

        {/* Section 1: What SAATHI Collects */}
        <Card className="space-y-3" data-testid="policy-section-collects">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-teal-700 dark:text-teal-400 shrink-0" />
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {t('policy.section1Title')}
            </h2>
          </div>
          <ul className="list-disc pl-5 space-y-2 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
            <li>{t('policy.section1Items.account')}</li>
            <li>{t('policy.section1Items.consents')}</li>
            <li>{t('policy.section1Items.contacts')}</li>
            <li>{t('policy.section1Items.incidents')}</li>
            <li>{t('policy.section1Items.journeys')}</li>
            <li>{t('policy.section1Items.reportsPulses')}</li>
          </ul>
        </Card>

        {/* Section 2: Who Can See Your Data */}
        <Card className="space-y-3" data-testid="policy-section-who">
          <div className="flex items-center gap-2">
            <Lock className="w-5 h-5 text-teal-700 dark:text-teal-400 shrink-0" />
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {t('policy.section2Title')}
            </h2>
          </div>
          <ul className="list-disc pl-5 space-y-2 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
            <li>{t('policy.section2Items.contacts')}</li>
            <li>{t('policy.section2Items.responders')}</li>
            <li>{t('policy.section2Items.admins')}</li>
            <li>{t('policy.section2Items.public')}</li>
          </ul>
        </Card>

        {/* Section 3: Retention Schedule */}
        <Card className="space-y-3" data-testid="policy-section-retention">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-teal-700 dark:text-teal-400 shrink-0" />
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {t('policy.section3Title')}
            </h2>
          </div>
          <ul className="list-disc pl-5 space-y-2 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
            <li>{t('policy.section3Items.locations')}</li>
            <li>{t('policy.section3Items.incidentTokens')}</li>
            <li>{t('policy.section3Items.invitations')}</li>
            <li>{t('policy.section3Items.journeyNotes')}</li>
            <li>{t('policy.section3Items.otpAndOutbox')}</li>
          </ul>
        </Card>

        {/* Section 4: Revoking Consent & Account Deletion */}
        <Card className="space-y-3" data-testid="policy-section-deletion">
          <div className="flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-teal-700 dark:text-teal-400 shrink-0" />
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {t('policy.section4Title')}
            </h2>
          </div>
          <ul className="list-disc pl-5 space-y-2 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
            <li>{t('policy.section4Items.revoke')}</li>
            <li>{t('policy.section4Items.delete')}</li>
          </ul>
        </Card>

        {/* Section 5: What SAATHI Never Does */}
        <Card className="space-y-3 border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/30" data-testid="policy-section-never">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0" />
            <h2 className="text-lg font-semibold text-amber-950 dark:text-amber-100">
              {t('policy.section5Title')}
            </h2>
          </div>
          <ul className="list-disc pl-5 space-y-2 text-sm text-amber-900 dark:text-amber-200 leading-relaxed">
            <li>{t('policy.section5Items.noBackgroundTracking')}</li>
            <li>{t('policy.section5Items.noGuaranteedPolice')}</li>
            <li>{t('policy.section5Items.noSilentSharing')}</li>
          </ul>
        </Card>

        <div className="flex flex-wrap gap-3 pt-2">
          <Link
            to="/consents"
            data-testid="policy-to-consents-link"
            className="min-h-[44px] inline-flex items-center px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {t('home.manageConsentsBtn')}
          </Link>
          <Link
            to="/settings"
            data-testid="policy-to-settings-link"
            className="min-h-[44px] inline-flex items-center px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {t('nav.settings')}
          </Link>
        </div>
      </div>
    </PageLayout>
  );
};
