import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
      <div className="max-w-xl mx-auto py-4 space-y-5 text-ink">
        <div className="flex items-center justify-between text-xs font-mono tabular-nums text-muted border-b border-line pb-2">
          <span className="font-semibold text-teal-700">
            {t('onboarding.stepIndicator', { current: step })}
          </span>
          <span>112 · 181 STATUTORY LINES</span>
        </div>

        <Card className="space-y-5 p-5 md:p-6 border border-line bg-surface rounded-2xl">
          <div className="space-y-2">
            <h1 className="text-xl md:text-2xl font-bold text-ink">
              {current.title}
            </h1>
            <p className="text-xs md:text-sm text-muted leading-relaxed">
              {current.body}
            </p>
          </div>

          {step === 3 && (
            <div className="rounded-xl border border-line bg-paper p-4 space-y-2.5">
              <h2 className="text-xs font-mono uppercase tracking-wider font-bold text-ink">
                {t('onboarding.step3.consentPromptTitle')}
              </h2>
              <p className="text-xs text-muted leading-relaxed">
                {t('onboarding.step3.consentPromptBody')}
              </p>
              <label className="min-h-[44px] flex items-start gap-3 cursor-pointer pt-1 select-none">
                <input
                  type="checkbox"
                  checked={consentChecked}
                  onChange={(e) => setConsentChecked(e.target.checked)}
                  className="mt-0.5 h-5 w-5 rounded-xl accent-teal-700 cursor-pointer"
                />
                <span className="text-xs md:text-sm font-medium text-ink">
                  {t('onboarding.step3.consentCheckboxLabel')}
                </span>
              </label>
              <div className="pt-1 border-t border-line/60">
                <Link
                  to="/policy"
                  data-testid="onboarding-policy-link"
                  className="text-xs font-mono font-semibold text-teal-700 underline underline-offset-4"
                >
                  {t('privacyTools.policyLinkBtn')}
                </Link>
              </div>
            </div>
          )}

          <div className="space-y-2 pt-2 border-t border-line">
            {step < 3 ? (
              <BigButton
                type="button"
                variant="primary"
                onClick={() =>
                  setStep((s) => (s < 3 ? ((s + 1) as 1 | 2 | 3) : s))
                }
              >
                {t('onboarding.nextBtn')}
              </BigButton>
            ) : (
              <div className="space-y-2">
                <BigButton
                  type="button"
                  variant="primary"
                  disabled={!consentChecked}
                  isLoading={isSavingConsent}
                  onClick={() => handleGrantAndNavigate('/circle')}
                >
                  {t('onboarding.finishCircleBtn')}
                </BigButton>
                <BigButton
                  type="button"
                  variant="outline"
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
                className="w-full text-xs"
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
