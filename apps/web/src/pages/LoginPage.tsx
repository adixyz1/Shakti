import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BigButton, Button, Card, Input } from '../components/ui';
import { PageLayout } from '../components/PageLayout';
import { authApi, ApiError } from '../lib/api';
import { useAuthStore } from '../store/authStore';

export const LoginPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { setUser, addToast } = useAuthStore();

  const [phone, setPhone] = useState('+919000000001');
  const [name, setName] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [otpCode, setOtpCode] = useState('');
  const [devOtpHint, setDevOtpHint] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setIsSubmitting(true);
    try {
      const res = await authApi.requestOtp(phone.trim());
      setDevOtpHint(res.dev_mock_hint || null);
      if (res.dev_mock_hint) {
        setOtpCode(res.dev_mock_hint);
      }
      setStep('otp');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to request OTP');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setIsSubmitting(true);
    try {
      const user = await authApi.verifyOtp({
        phone_e164: phone.trim(),
        code: otpCode.trim(),
        name: name.trim() || undefined,
      });
      setUser(user);
      if (user.language && user.language !== i18n.language) {
        await i18n.changeLanguage(user.language);
        window.localStorage.setItem('saathi_lang', user.language);
      }
      addToast(t('home.welcomeBack', { name: user.name }), 'success');
      navigate('/home');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to verify OTP');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectDemoPhone = (demoPhone: string) => {
    setPhone(demoPhone);
    setStep('phone');
    setError(undefined);
  };

  return (
    <PageLayout>
      <div className="max-w-md mx-auto py-4 space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">
            {t('login.title')}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t('login.subtitle')}
          </p>
        </div>

        <Card className="space-y-6">
          {step === 'phone' ? (
            <form onSubmit={handleRequestOtp} className="space-y-4">
              <Input
                label={t('login.phoneLabel')}
                placeholder={t('login.phonePlaceholder')}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                error={error}
                required
                autoComplete="tel"
              />
              <Input
                label={t('login.nameLabel')}
                placeholder={t('login.namePlaceholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
              <BigButton type="submit" isLoading={isSubmitting}>
                {t('login.requestOtpBtn')}
              </BigButton>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              {devOtpHint && (
                <div className="rounded-xl bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800 p-4 space-y-1">
                  <p className="text-xs font-semibold text-teal-900 dark:text-teal-200">
                    {t('login.mockNoticeTitle')}
                  </p>
                  <p className="text-xs text-teal-800 dark:text-teal-300">
                    {t('login.mockNoticeBody')}{' '}
                    <span className="font-mono font-bold tabular-nums text-sm underline">
                      {devOtpHint}
                    </span>
                  </p>
                </div>
              )}

              <Input
                label={t('login.otpLabel')}
                placeholder={t('login.otpPlaceholder')}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                error={error}
                maxLength={6}
                className="font-mono tabular-nums tracking-widest text-lg"
                required
                autoComplete="one-time-code"
              />

              <BigButton type="submit" isLoading={isSubmitting}>
                {t('login.verifyOtpBtn')}
              </BigButton>

              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setStep('phone');
                  setError(undefined);
                }}
              >
                {t('login.changePhoneBtn')}
              </Button>
            </form>
          )}
        </Card>

        {/* Seeded Demo Accounts for instant verification */}
        <div className="space-y-2 pt-2">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('login.demoAccountsTitle')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => selectDemoPhone('+919000000001')}
              className="text-xs"
            >
              {t('login.demoUser')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => selectDemoPhone('+919000000002')}
              className="text-xs"
            >
              {t('login.demoResponder')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => selectDemoPhone('+919000000003')}
              className="text-xs"
            >
              {t('login.demoAdmin')}
            </Button>
          </div>
        </div>
      </div>
    </PageLayout>
  );
};
