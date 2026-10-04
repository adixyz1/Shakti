import React from 'react';
import {
  Loader2,
  X,
  Home as HomeIcon,
  Users as UsersIcon,
  ShieldCheck as ShieldIcon,
  Settings as SettingsIcon,
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../store/authStore';

export const Spinner: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <Loader2
    className={`animate-spin motion-reduce:animate-none text-current ${className}`}
    aria-label="Loading"
  />
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  isLoading = false,
  className = '',
  disabled,
  ...props
}) => {
  const variants: Record<NonNullable<ButtonProps['variant']>, string> = {
    primary:
      'bg-teal-700 text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500',
    secondary:
      'bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200',
    outline:
      'border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800',
    ghost:
      'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800',
    danger:
      'bg-rose-700 text-white hover:bg-rose-800 dark:bg-rose-600 dark:hover:bg-rose-500',
  };

  return (
    <button
      disabled={disabled || isLoading}
      className={`min-h-[44px] px-4 py-2 rounded-xl font-medium text-sm inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950 disabled:opacity-50 disabled:pointer-events-none ${variants[variant]} ${className}`}
      {...props}
    >
      {isLoading && <Spinner className="w-4 h-4" />}
      {children}
    </button>
  );
};

export const BigButton: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  isLoading = false,
  className = '',
  disabled,
  ...props
}) => {
  const variants: Record<NonNullable<ButtonProps['variant']>, string> = {
    primary:
      'bg-teal-700 text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 shadow-sm',
    secondary:
      'bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900',
    outline:
      'border-2 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800',
    ghost:
      'text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800',
    danger:
      'bg-rose-700 text-white hover:bg-rose-800 dark:bg-rose-600 dark:hover:bg-rose-500 shadow-sm',
  };

  return (
    <button
      disabled={disabled || isLoading}
      className={`min-h-[56px] w-full px-6 py-3.5 rounded-2xl font-semibold text-base inline-flex items-center justify-center gap-3 transition-transform duration-150 active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-500/50 disabled:opacity-50 disabled:pointer-events-none ${variants[variant]} ${className}`}
      {...props}
    >
      {isLoading && <Spinner className="w-5 h-5" />}
      {children}
    </button>
  );
};

export const Card: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = '' }) => (
  <div
    className={`rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 ${className}`}
  >
    {children}
  </div>
);

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  id,
  className = '',
  ...props
}) => {
  const inputId = id || `input-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div className="w-full space-y-1.5">
      <label
        htmlFor={inputId}
        className="block text-sm font-medium text-slate-800 dark:text-slate-200"
      >
        {label}
      </label>
      <input
        id={inputId}
        className={`w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border ${
          error
            ? 'border-rose-600 dark:border-rose-500'
            : 'border-slate-300 dark:border-slate-700'
        } text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 transition-colors ${className}`}
        {...props}
      />
      {error && (
        <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
};

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useAuthStore();
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-20 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-center justify-between gap-3 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-4 py-2 text-sm shadow-lg border border-slate-700 dark:border-slate-300"
        >
          <span>{toast.title}</span>
          <button
            type="button"
            onClick={() => removeToast(toast.id)}
            aria-label="Dismiss notification"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg hover:bg-white/10 dark:hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};

export const Modal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}> = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="saathi-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <h2
            id="saathi-modal-title"
            className="text-lg font-semibold text-slate-900 dark:text-slate-100"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          {children}
        </div>
      </div>
    </div>
  );
};

export const BottomNav: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);

  if (!user) return null;

  const navItems = [
    { to: '/home', label: t('nav.home'), icon: HomeIcon },
    { to: '/circle', label: t('nav.circle'), icon: UsersIcon },
    { to: '/consents', label: t('nav.consents'), icon: ShieldIcon },
    { to: '/settings', label: t('nav.settings'), icon: SettingsIcon },
  ];

  return (
    <nav
      aria-label="Mobile bottom navigation"
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 grid grid-cols-4 items-center"
    >
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = location.pathname === item.to;
        return (
          <Link
            key={item.to}
            to={item.to}
            className={`min-h-[48px] flex flex-col items-center justify-center text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${
              active
                ? 'text-teal-700 dark:text-teal-400'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <Icon className="w-5 h-5" />
            <span className="mt-1">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
};
