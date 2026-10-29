import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bell } from 'lucide-react';
import { BigButton, Button, Card, Input } from '../components/ui';
import { PageLayout } from '../components/PageLayout';
import { LoudAlarmModal } from '../components/LoudAlarmModal';
import { authApi, ApiError } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { useDemoStore } from '../store/demoStore';
import {
  isPrototypeZeroAuthMode,
  switchStandalonePrototypeRole,
} from '../lib/standaloneApkApi';

export const LoginPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { setUser, addToast } = useAuthStore();
  const { checked, checkDemoMode } = useDemoStore();

  const [showLoudAlarm, setShowLoudAlarm] = useState(false);
  const [phone, setPhone] = useState('+919000000001');
  const [name, setName] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [otpCode, setOtpCode] = useState('');
  const [devOtpHint, setDevOtpHint] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!checked) {
      void checkDemoMode();
    }
  }, [checked, checkDemoMode]);

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
    if (isPrototypeZeroAuthMode()) {
      const role =
        demoPhone === '+919000000002'
          ? 'responder'
          : demoPhone === '+919000000003'
            ? 'admin'
            : 'user';
      const demoUser = switchStandalonePrototypeRole(role);
      setUser(demoUser);
      addToast(t('home.welcomeBack', { name: demoUser.name }), 'success');
      navigate(
        role === 'responder'
          ? '/responder'
          : role === 'admin'
            ? '/admin'
            : '/home'
      );
    }
  };

  return (
    <PageLayout>
      <div className="max-w-md mx-auto py-2 space-y-6">
        {/* Top Context Bar */}
        <div className="flex items-center justify-between pb-3 border-b border-line dark:border-slate-800">
          <div aria-label="Encryption status: End-to-end encrypted protocol" className="flex items-center gap-1.5 px-2.5 py-1 bg-surface dark:bg-slate-900 border border-line dark:border-slate-800 rounded-full">
            <span className="w-1.5 h-1.5 bg-teal-700 rounded-full"></span>
            <span className="font-mono text-[11px] text-muted dark:text-slate-300 uppercase tracking-wider font-semibold">
              E2E VERIFIED
            </span>
          </div>
          <span className="text-[11px] font-mono text-muted dark:text-slate-300">SECURE PROTOCOL</span>
        </div>

        {/* Header */}
        <header className="space-y-1">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-ink dark:text-slate-100">
            {t('login.title')}
          </h1>
          <p className="text-xs md:text-sm text-muted dark:text-slate-300 leading-relaxed">
            {t('login.subtitle')}
          </p>
        </header>

        {/* Immediate Danger Quick Siren (No login required) */}
        <div className="p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-xl flex items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-2.5">
            <Bell className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0" />
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              {t('login.emergencyNotice')}
            </span>
          </div>
          <button
            type="button"
            data-testid="login-loud-alarm-btn"
            onClick={() => setShowLoudAlarm(true)}
            className="px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-xs transition-colors shrink-0 cursor-pointer"
          >
            {t('login.loudAlarmBtn')}
          </button>
        </div>

        <Card className="space-y-5 border border-line bg-surface rounded-2xl shadow-sm">
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

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full min-h-[48px] px-4 py-3 bg-teal-700 active:bg-teal-800 text-surface rounded-xl font-mono text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-sm disabled:opacity-50"
              >
                <span>{isSubmitting ? 'Requesting...' : t('login.requestOtpBtn')}</span>
                <svg className="w-4 h-4 stroke-current fill-none stroke-2" strokeLinecap="square" strokeLinejoin="miter" viewBox="0 0 24 24">
                  <line x1="5" x2="19" y1="12" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              {Boolean(devOtpHint) && (
                <div
                  data-testid="demo-otp-hint"
                  className="bg-paper border border-teal-700/60 p-3 rounded-xl space-y-1"
                >
                  <p className="text-xs font-mono font-bold text-teal-800 uppercase tracking-wider">
                    {t('login.mockNoticeTitle')}
                  </p>
                  <p className="text-xs text-ink leading-relaxed">
                    {t('login.mockNoticeBody')}{' '}
                    <span className="font-mono font-bold tabular-nums text-sm underline text-teal-800">
                      Demo code: {devOtpHint}
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
                className="font-mono tabular-nums tracking-widest text-lg text-center"
                required
                autoComplete="one-time-code"
              />

              <BigButton type="submit" variant="primary" isLoading={isSubmitting}>
                {t('login.verifyOtpBtn')}
              </BigButton>

              <Button
                type="button"
                variant="ghost"
                className="w-full text-xs rounded-xl"
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

        {/* Demo Accounts */}
        <div className="space-y-2 pt-2 border-t border-line dark:border-slate-800">
          <p className="text-xs font-mono text-muted dark:text-slate-300 uppercase tracking-wider">
            {t('login.demoAccountsTitle')}
          </p>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => selectDemoPhone('+919000000001')}
              className="h-10 px-2 border border-line dark:border-slate-700 rounded-xl bg-surface dark:bg-slate-800 text-ink dark:text-slate-100 text-xs font-mono hover:bg-surface-container dark:hover:bg-slate-700 shadow-2xs"
            >
              {t('login.demoUser')}
            </button>
            <button
              type="button"
              onClick={() => selectDemoPhone('+919000000002')}
              className="h-10 px-2 border border-line dark:border-slate-700 rounded-xl bg-surface dark:bg-slate-800 text-ink dark:text-slate-100 text-xs font-mono hover:bg-surface-container dark:hover:bg-slate-700 shadow-2xs"
            >
              {t('login.demoResponder')}
            </button>
            <button
              type="button"
              onClick={() => selectDemoPhone('+919000000003')}
              className="h-10 px-2 border border-line dark:border-slate-700 rounded-xl bg-surface dark:bg-slate-800 text-ink dark:text-slate-100 text-xs font-mono hover:bg-surface-container dark:hover:bg-slate-700 shadow-2xs"
            >
              {t('login.demoAdmin')}
            </button>
          </div>
        </div>

        {/* System Scope and Disclosures per Stitch sign_in */}
        <section aria-label="Safety compliance and legal assurances" className="space-y-3 pt-3">
          <div className="p-3 bg-surface dark:bg-slate-900 border border-line dark:border-slate-800 rounded-xl space-y-1">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 stroke-teal-700 fill-none stroke-2 shrink-0" strokeLinecap="square" strokeLinejoin="miter" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9" />
                <line x1="12" x2="12" y1="8" y2="12" />
                <line x1="12" x2="12.01" y1="16" y2="16" />
              </svg>
              <span className="font-mono text-[11px] text-ink dark:text-slate-100 uppercase tracking-wider font-semibold">
                System Scope
              </span>
            </div>
            <p className="text-xs text-ink dark:text-slate-100 font-semibold">
              SHAKTI complements 112 and 181 emergency services.
            </p>
            <p className="text-xs text-muted dark:text-slate-300 leading-relaxed">
              SHAKTI is a dedicated community alert and peer-tracking protocol. It does not replace direct statutory law enforcement response.
            </p>
          </div>

          <p className="text-xs text-muted dark:text-slate-300 leading-relaxed px-1">
            Your phone number is only used for authentication and circle dispatch. We never sell or share user data.
          </p>
        </section>
      </div>

      <LoudAlarmModal
        isOpen={showLoudAlarm}
        onClose={() => setShowLoudAlarm(false)}
      />
    </PageLayout>
  );
};
