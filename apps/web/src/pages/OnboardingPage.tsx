import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BigButton, Button, Card } from '../components/ui';
import { PageLayout } from '../components/PageLayout';
import { consentsApi } from '../lib/api';
import { useAuthStore } from '../store/authStore';

export const OnboardingPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addToast = useAuthStore((s) => s.addToast);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [dataProcessingGranted, setDataProcessingGranted] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [isSavingConsent, setIsSavingConsent] = useState(false);

  useEffect(() => {
    let active = true;
    consentsApi
      .getConsents()
      .then((res) => {
        if (active) {
          setDataProcessingGranted(Boolean(res.current.data_processing));
          setConsentChecked(Boolean(res.current.data_processing));
        }
      })
      .catch(() => {
        // ignore if unauthenticated or offline
      });
    return () => {
      active = false;
    };
  }, []);

  const steps = [
    {
      num: 1 as const,
      title: t('onboarding.step1.title'),
      body: t('onboarding.step1.body'),
    },
    {
      num: 2 as const,
      title: t('onboarding.step2.title'),
      body: t('onboarding.step2.body'),
    },
    {
      num: 3 as const,
      title: t('onboarding.step3.title'),
      body: t('onboarding.step3.body'),
    },
  ];

  const current = steps[step - 1];

  const handleGrantAndNavigate = async (targetPath: string) => {
    if (!dataProcessingGranted && consentChecked) {
      setIsSavingConsent(true);
      try {
        const res = await consentsApi.postConsent({
          type: 'data_processing',
          granted: true,
          source: 'onboarding',
        });
        setDataProcessingGranted(Boolean(res.current.data_processing));
      } catch (err) {
        addToast(
          err instanceof Error ? err.message : 'Failed to save consent',
          'error'
        );
        setIsSavingConsent(false);
        return;
      }
      setIsSavingConsent(false);
    }
    navigate(targetPath);
  };

  return (
    <PageLayout>
      <div className="max-w-xl mx-auto py-6 space-y-6">
        <div className="flex items-center justify-between text-xs font-mono tabular-nums text-teal-800 dark:text-teal-400">
          <span>{t('onboarding.stepIndicator', { current: step })}</span>
          <span>112 · 181</span>
        </div>

        <Card className="space-y-6 p-6 md:p-8">
          <div className="space-y-3">
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">
              {current.title}
            </h1>
            <p className="text-base text-slate-600 dark:text-slate-300 leading-relaxed">
              {current.body}
            </p>
          </div>

          {step === 3 && (
            <div className="rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50/60 dark:bg-teal-950/30 p-4 space-y-3">
              <h2 className="text-sm font-semibold text-teal-900 dark:text-teal-200">
                {t('onboarding.step3.consentPromptTitle')}
              </h2>
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                {t('onboarding.step3.consentPromptBody')}
              </p>
              <label className="min-h-[44px] flex items-start gap-3 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={consentChecked}
                  onChange={(e) => setConsentChecked(e.target.checked)}
                  className="mt-1 h-5 w-5 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                />
                <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {t('onboarding.step3.consentCheckboxLabel')}
                </span>
              </label>
            </div>
          )}

          <div className="space-y-3 pt-2">
            {step < 3 ? (
              <BigButton
                type="button"
                onClick={() =>
                  setStep((s) => (s < 3 ? ((s + 1) as 1 | 2 | 3) : s))
                }
              >
                {t('onboarding.nextBtn')}
              </BigButton>
            ) : (
              <div className="space-y-3">
                <BigButton
                  type="button"
                  disabled={!consentChecked}
                  isLoading={isSavingConsent}
                  onClick={() => handleGrantAndNavigate('/circle')}
                >
                  {t('onboarding.finishCircleBtn')}
                </BigButton>
                <BigButton
                  type="button"
                  variant="secondary"
                  disabled={isSavingConsent}
                  onClick={() => handleGrantAndNavigate('/consents')}
                >
                  {t('onboarding.finishConsentsBtn')}
                </BigButton>
              </div>
            )}

            {step > 1 && (
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() =>
                  setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))
                }
              >
                {t('onboarding.prevBtn')}
              </Button>
            )}
          </div>
        </Card>
      </div>
    </PageLayout>
  );
};
