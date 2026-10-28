import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card } from '../components/ui';
import { PageLayout } from '../components/PageLayout';

export const PolicyPage: React.FC = () => {
  const { t } = useTranslation();

  return (
    <PageLayout>
      <div className="max-w-3xl mx-auto space-y-6 py-2 text-ink" data-testid="policy-page">
        {/* Header */}
        <header className="space-y-1.5 border-b border-line pb-4">
          <div className="flex items-center gap-2">
            <svg
              className="w-6 h-6 stroke-ink fill-none stroke-2 shrink-0"
              strokeLinecap="square"
              strokeLinejoin="miter"
              viewBox="0 0 24 24"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" x2="8" y1="13" y2="13" />
              <line x1="16" x2="8" y1="17" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-ink">
              {t('policy.title')}
            </h1>
          </div>
          <p className="text-xs md:text-sm text-muted leading-relaxed">
            {t('policy.subtitle')}
          </p>
        </header>

        {/* Section 1: What SAATHI Collects */}
        <Card className="space-y-3 border border-line bg-surface rounded-2xl" data-testid="policy-section-collects">
          <div className="flex items-center gap-2 border-b border-line pb-2">
            <span className="w-2 h-2 bg-teal-700 rounded-full shrink-0" />
            <h2 className="text-sm font-mono uppercase tracking-wider font-bold text-ink">
              {t('policy.section1Title')}
            </h2>
          </div>
          <ul className="list-disc pl-5 space-y-2 text-xs md:text-sm text-ink leading-relaxed">
            <li>{t('policy.section1Items.account')}</li>
            <li>{t('policy.section1Items.consents')}</li>
            <li>{t('policy.section1Items.contacts')}</li>
            <li>{t('policy.section1Items.incidents')}</li>
            <li>{t('policy.section1Items.journeys')}</li>
            <li>{t('policy.section1Items.reportsPulses')}</li>
          </ul>
        </Card>

        {/* Section 2: Who Can See Your Data */}
        <Card className="space-y-3 border border-line bg-surface rounded-2xl" data-testid="policy-section-who">
          <div className="flex items-center gap-2 border-b border-line pb-2">
            <span className="w-2 h-2 bg-teal-700 rounded-full shrink-0" />
            <h2 className="text-sm font-mono uppercase tracking-wider font-bold text-ink">
              {t('policy.section2Title')}
            </h2>
          </div>
          <ul className="list-disc pl-5 space-y-2 text-xs md:text-sm text-ink leading-relaxed">
            <li>{t('policy.section2Items.contacts')}</li>
            <li>{t('policy.section2Items.responders')}</li>
            <li>{t('policy.section2Items.admins')}</li>
            <li>{t('policy.section2Items.public')}</li>
          </ul>
        </Card>

        {/* Section 3: Retention Schedule */}
        <Card className="space-y-3 border border-line bg-surface rounded-2xl" data-testid="policy-section-retention">
          <div className="flex items-center gap-2 border-b border-line pb-2">
            <span className="w-2 h-2 bg-teal-700 rounded-full shrink-0" />
            <h2 className="text-sm font-mono uppercase tracking-wider font-bold text-ink">
              {t('policy.section3Title')}
            </h2>
          </div>
          <ul className="list-disc pl-5 space-y-2 text-xs md:text-sm text-ink leading-relaxed">
            <li>{t('policy.section3Items.locations')}</li>
            <li>{t('policy.section3Items.incidentTokens')}</li>
            <li>{t('policy.section3Items.invitations')}</li>
            <li>{t('policy.section3Items.journeyNotes')}</li>
            <li>{t('policy.section3Items.otpAndOutbox')}</li>
          </ul>
        </Card>

        {/* Section 4: Revoking Consent & Account Deletion */}
        <Card className="space-y-3 border border-line bg-surface rounded-2xl" data-testid="policy-section-deletion">
          <div className="flex items-center gap-2 border-b border-line pb-2">
            <span className="w-2 h-2 bg-teal-700 rounded-full shrink-0" />
            <h2 className="text-sm font-mono uppercase tracking-wider font-bold text-ink">
              {t('policy.section4Title')}
            </h2>
          </div>
          <ul className="list-disc pl-5 space-y-2 text-xs md:text-sm text-ink leading-relaxed">
            <li>{t('policy.section4Items.revoke')}</li>
            <li>{t('policy.section4Items.delete')}</li>
          </ul>
        </Card>

        {/* Section 5: What SAATHI Never Does */}
        <Card className="space-y-3 border-2 border-crimson-800 bg-paper rounded-2xl" data-testid="policy-section-never">
          <div className="flex items-center gap-2 border-b border-crimson-800/30 pb-2">
            <span className="w-2 h-2 bg-crimson-800 rounded-full shrink-0" />
            <h2 className="text-sm font-mono uppercase tracking-wider font-bold text-crimson-800">
              {t('policy.section5Title')}
            </h2>
          </div>
          <ul className="list-disc pl-5 space-y-2 text-xs md:text-sm text-ink leading-relaxed">
            <li>{t('policy.section5Items.noBackgroundTracking')}</li>
            <li>{t('policy.section5Items.noGuaranteedPolice')}</li>
            <li>{t('policy.section5Items.noSilentSharing')}</li>
          </ul>
        </Card>

        {/* Section 6: Guest Mode & Device-Only Privacy */}
        <Card className="space-y-3 border border-line bg-surface rounded-2xl" data-testid="policy-section-guest">
          <div className="flex items-center gap-2 border-b border-line pb-2">
            <span className="w-2 h-2 bg-teal-700 rounded-full shrink-0" />
            <h2 className="text-sm font-mono uppercase tracking-wider font-bold text-ink">
              {t('policy.section6Title')}
            </h2>
          </div>
          <ul className="list-disc pl-5 space-y-2 text-xs md:text-sm text-ink leading-relaxed">
            <li>{t('policy.section6Items.localOnly')}</li>
            <li>{t('policy.section6Items.guestSos')}</li>
            <li>{t('policy.section6Items.duressRequiresAccount')}</li>
          </ul>
        </Card>

        {/* Section 7: Safety Tools Guide & Outbound Links */}
        <Card className="space-y-3 border border-line bg-surface rounded-2xl" data-testid="policy-section-safety-tools">
          <div className="flex items-center gap-2 border-b border-line pb-2">
            <span className="w-2 h-2 bg-teal-700 rounded-full shrink-0" />
            <h2 className="text-sm font-mono uppercase tracking-wider font-bold text-ink">
              {t('policy.section7Title')}
            </h2>
          </div>
          <ul className="list-disc pl-5 space-y-2 text-xs md:text-sm text-ink leading-relaxed">
            <li>{t('policy.section7Items.noTracking')}</li>
            <li>{t('policy.section7Items.noPurchaseData')}</li>
            <li>{t('policy.section7Items.outboundLinks')}</li>
            <li>{t('policy.section7Items.notEndorsements')}</li>
          </ul>
        </Card>

        <div className="flex flex-wrap gap-2 pt-2 border-t border-line">
          <Link
            to="/consents"
            data-testid="policy-to-consents-link"
            className="h-10 inline-flex items-center px-4 rounded-xl border border-line bg-surface text-xs font-mono font-semibold text-ink hover:bg-surface-container"
          >
            {t('home.manageConsentsBtn')}
          </Link>
          <Link
            to="/settings"
            data-testid="policy-to-settings-link"
            className="h-10 inline-flex items-center px-4 rounded-xl border border-line bg-surface text-xs font-mono font-semibold text-ink hover:bg-surface-container"
          >
            {t('nav.settings')}
          </Link>
        </div>
      </div>
    </PageLayout>
  );
};
