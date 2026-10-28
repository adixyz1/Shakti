import React from 'react';
import { useTranslation } from 'react-i18next';
import { authApi } from '../lib/api';
import { useAuthStore } from '../store/authStore';

export const LanguageToggle: React.FC = () => {
  const { i18n, t } = useTranslation();
  const { user, setUser } = useAuthStore();

  const currentLang = i18n.language === 'hi' ? 'hi' : 'en';

  const handleSwitch = async (nextLang: 'en' | 'hi') => {
    if (nextLang === currentLang) return;
    await i18n.changeLanguage(nextLang);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('saathi_lang', nextLang);
    }
    if (user) {
      try {
        const updated = await authApi.updateMe({ language: nextLang });
        setUser(updated);
      } catch {
        // Keep local language change even if network is offline
      }
    }
  };

  return (
    <div
      role="group"
      aria-label={t('app.language')}
      className="inline-flex items-center p-0.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
    >
      <button
        type="button"
        onClick={() => handleSwitch('en')}
        aria-label={t('app.english')}
        aria-pressed={currentLang === 'en'}
        className={`min-h-[36px] min-w-[36px] px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${
          currentLang === 'en'
            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
            : 'text-slate-800 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white'
        }`}
      >
        {t('app.english')}
      </button>
      <button
        type="button"
        onClick={() => handleSwitch('hi')}
        aria-label={t('app.hindi')}
        aria-pressed={currentLang === 'hi'}
        className={`min-h-[36px] min-w-[36px] px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${
          currentLang === 'hi'
            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
            : 'text-slate-800 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white'
        }`}
      >
        {t('app.hindi')}
      </button>
    </div>
  );
};
