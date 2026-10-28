import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Shield, Lock, ArrowRight, Phone, MapPin, Settings as SettingsIcon, AlertCircle, Bell } from 'lucide-react';
import { PageLayout } from '../components/PageLayout';
import { BigButton, Button, Card } from '../components/ui';
import { LoudAlarmModal } from '../components/LoudAlarmModal';

export type AccountRequiredFeature =
  | 'circle'
  | 'journeys'
  | 'consents'
  | 'onboarding'
  | 'responder'
  | 'admin'
  | 'data'
  | 'general';

interface AccountRequiredPageProps {
  feature?: AccountRequiredFeature;
}

export const AccountRequiredPage: React.FC<AccountRequiredPageProps> = ({
  feature = 'general',
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [showLoudAlarm, setShowLoudAlarm] = useState(false);

  const getExplanation = () => {
    switch (feature) {
      case 'circle':
        return t('accountRequired.whyCircle');
      case 'journeys':
        return t('accountRequired.whyJourneys');
      case 'consents':
        return t('accountRequired.whyConsents');
      case 'data':
        return t('accountRequired.whyData');
      case 'onboarding':
        return t('accountRequired.whyOnboarding');
      case 'responder':
        return t('accountRequired.whyResponder');
      case 'admin':
        return t('accountRequired.whyAdmin');
      default:
        return t('accountRequired.whyGeneral');
    }
  };

  return (
    <PageLayout>
      <div
        className="max-w-2xl mx-auto space-y-6 py-6"
        data-testid="account-required-page"
      >
        <Card className="p-6 md:p-8 space-y-6 border border-line dark:border-slate-800 bg-surface dark:bg-slate-900 rounded-2xl shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-teal-50 dark:bg-teal-950/50 flex items-center justify-center text-teal-700 dark:text-teal-400">
              <Lock className="w-6 h-6 stroke-2" />
            </div>
            <div>
              <h1
                className="text-xl md:text-2xl font-bold tracking-tight text-ink dark:text-slate-100"
                data-testid="account-required-title"
              >
                {t('accountRequired.title')}
              </h1>
              <p className="text-xs md:text-sm text-muted dark:text-slate-400">
                {t('accountRequired.subtitle')}
              </p>
            </div>
          </div>

          <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-line dark:border-slate-800 rounded-xl space-y-2">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-teal-700 dark:text-teal-400 shrink-0 mt-0.5" />
              <p
                data-testid="account-required-reason"
                className="text-xs md:text-sm text-ink dark:text-slate-200 leading-relaxed font-medium"
              >
                {getExplanation()}
              </p>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <BigButton
              variant="primary"
              onClick={() => navigate('/login')}
              data-testid="account-required-signin-btn"
            >
              {t('accountRequired.signInCta')}
            </BigButton>
          </div>
        </Card>

        {/* Guest tools available right now on this phone */}
        <div className="space-y-3">
          <h2 className="text-xs font-mono uppercase tracking-wider font-semibold text-muted dark:text-slate-400 px-1">
            {t('accountRequired.guestToolsIntro')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Card
              data-testid="account-required-home-btn"
              onClick={() => navigate('/home')}
              className="p-4 border border-line dark:border-slate-800 bg-surface dark:bg-slate-900 rounded-xl hover:border-teal-600 transition-colors cursor-pointer flex items-center justify-between group"
            >
              <div className="flex items-center gap-3">
                <Shield className="w-5 h-5 text-crimson-600 dark:text-crimson-400 shrink-0" />
                <span className="text-sm font-semibold text-ink dark:text-slate-100">
                  {t('accountRequired.btnHome')}
                </span>
              </div>
              <ArrowRight className="w-4 h-4 text-muted group-hover:translate-x-0.5 transition-transform" />
            </Card>

            <Card
              data-testid="account-required-alarm-btn"
              onClick={() => setShowLoudAlarm(true)}
              className="p-4 border border-line dark:border-slate-800 bg-surface dark:bg-slate-900 rounded-xl hover:border-amber-600 transition-colors cursor-pointer flex items-center justify-between group"
            >
              <div className="flex items-center gap-3">
                <Bell className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="text-sm font-semibold text-ink dark:text-slate-100">
                  {t('accountRequired.btnLoudAlarm')}
                </span>
              </div>
              <ArrowRight className="w-4 h-4 text-muted group-hover:translate-x-0.5 transition-transform" />
            </Card>

            <Card
              onClick={() => navigate('/resources')}
              className="p-4 border border-line dark:border-slate-800 bg-surface dark:bg-slate-900 rounded-xl hover:border-teal-600 transition-colors cursor-pointer flex items-center justify-between group"
            >
              <div className="flex items-center gap-3">
                <Phone className="w-5 h-5 text-teal-700 dark:text-teal-400 shrink-0" />
                <span className="text-sm font-semibold text-ink dark:text-slate-100">
                  {t('accountRequired.btnHelplines')}
                </span>
              </div>
              <ArrowRight className="w-4 h-4 text-muted group-hover:translate-x-0.5 transition-transform" />
            </Card>

            <Card
              onClick={() => navigate('/reports')}
              className="p-4 border border-line dark:border-slate-800 bg-surface dark:bg-slate-900 rounded-xl hover:border-teal-600 transition-colors cursor-pointer flex items-center justify-between group"
            >
              <div className="flex items-center gap-3">
                <MapPin className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="text-sm font-semibold text-ink dark:text-slate-100">
                  {t('accountRequired.btnHazards')}
                </span>
              </div>
              <ArrowRight className="w-4 h-4 text-muted group-hover:translate-x-0.5 transition-transform" />
            </Card>

            <Card
              onClick={() => navigate('/settings')}
              className="p-4 border border-line dark:border-slate-800 bg-surface dark:bg-slate-900 rounded-xl hover:border-teal-600 transition-colors cursor-pointer flex items-center justify-between group"
            >
              <div className="flex items-center gap-3">
                <SettingsIcon className="w-5 h-5 text-slate-600 dark:text-slate-400 shrink-0" />
                <span className="text-sm font-semibold text-ink dark:text-slate-100">
                  {t('accountRequired.btnSettings')}
                </span>
              </div>
              <ArrowRight className="w-4 h-4 text-muted group-hover:translate-x-0.5 transition-transform" />
            </Card>
          </div>
        </div>
      </div>

      <LoudAlarmModal
        isOpen={showLoudAlarm}
        onClose={() => setShowLoudAlarm(false)}
      />
    </PageLayout>
  );
};
