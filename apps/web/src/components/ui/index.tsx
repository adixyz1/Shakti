import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../store/authStore';

// Custom Inline SVGs matching Stitch Paper Utility specifications:
// 24px viewBox, stroke-2, stroke-linecap="square", stroke-linejoin="miter"

export const Spinner: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg
    className={`animate-spin motion-reduce:animate-none stroke-current fill-none stroke-2 ${className}`}
    strokeLinecap="square"
    strokeLinejoin="miter"
    viewBox="0 0 24 24"
    role="img"
    aria-label="Loading"
  >
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

export const XIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg
    className={`stroke-current fill-none stroke-2 ${className}`}
    strokeLinecap="square"
    strokeLinejoin="miter"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export const HomeIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg
    className={`stroke-current fill-none stroke-2 ${className}`}
    strokeLinecap="square"
    strokeLinejoin="miter"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path d="M3 10.5L12 3l9 7.5V21H3V10.5z" />
    <path d="M9 21v-7h6v7" />
  </svg>
);

export const UsersIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg
    className={`stroke-current fill-none stroke-2 ${className}`}
    strokeLinecap="square"
    strokeLinejoin="miter"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <circle cx="9" cy="8" r="4" />
    <path d="M2 20c0-3.5 3.5-5 7-5s7 1.5 7 5" />
    <circle cx="17" cy="7" r="3" />
    <path d="M17 14c2.5 0 5 1 5 4" />
  </svg>
);

export const ShieldIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg
    className={`stroke-current fill-none stroke-2 ${className}`}
    strokeLinecap="square"
    strokeLinejoin="miter"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

export const SettingsIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg
    className={`stroke-current fill-none stroke-2 ${className}`}
    strokeLinecap="square"
    strokeLinejoin="miter"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export const MapIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg
    className={`stroke-current fill-none stroke-2 ${className}`}
    strokeLinecap="square"
    strokeLinejoin="miter"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21 3 6" />
    <line x1="9" y1="3" x2="9" y2="18" />
    <line x1="15" y1="6" x2="15" y2="21" />
  </svg>
);

export const CheckIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg
    className={`stroke-current fill-none stroke-2 ${className}`}
    strokeLinecap="square"
    strokeLinejoin="miter"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const PhoneIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg
    className={`stroke-current fill-none stroke-2 ${className}`}
    strokeLinecap="square"
    strokeLinejoin="miter"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  isLoading?: boolean;
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  isLoading = false,
  fullWidth = false,
  className = '',
  disabled,
  ...props
}) => {
  const variants: Record<NonNullable<ButtonProps['variant']>, string> = {
    primary:
      'bg-teal-700 text-white hover:bg-teal-800 active:bg-teal-800 border border-teal-800 dark:bg-teal-700 dark:text-white dark:hover:bg-teal-800 dark:border-teal-800',
    secondary:
      'bg-ink text-surface hover:bg-slate-800 active:bg-slate-900 border border-ink dark:bg-night-surface dark:text-night-text dark:border-night-line dark:hover:bg-night',
    outline:
      'bg-surface border border-line text-ink hover:bg-surface-container active:bg-surface-container-high dark:bg-night-surface dark:border-night-line dark:text-night-text dark:hover:bg-night',
    ghost:
      'text-ink hover:bg-surface-container border border-transparent active:bg-surface-container-high dark:text-night-text dark:hover:bg-night-surface',
    danger:
      'bg-crimson-800 text-white hover:bg-crimson-900 active:bg-crimson-900 border border-crimson-900 dark:bg-crimson-800 dark:text-white dark:hover:bg-crimson-900 dark:border-crimson-900',
  };

  return (
    <button
      disabled={disabled || isLoading}
      className={`min-h-[48px] px-4 py-2.5 rounded-xl font-semibold text-sm inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 disabled:opacity-50 disabled:pointer-events-none shadow-sm ${
        fullWidth ? 'w-full' : ''
      } ${variants[variant]} ${className}`}
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
      'bg-teal-700 text-white hover:bg-teal-800 active:bg-teal-800 border border-teal-800 dark:bg-teal-700 dark:text-white dark:hover:bg-teal-800 dark:border-teal-800',
    secondary:
      'bg-ink text-surface hover:bg-slate-800 active:bg-slate-900 border border-ink dark:bg-night-surface dark:text-night-text dark:border-night-line',
    outline:
      'bg-surface border-2 border-line text-ink hover:bg-surface-container active:bg-surface-container-high dark:bg-night-surface dark:border-night-line dark:text-night-text',
    ghost:
      'bg-transparent text-ink hover:bg-surface-container border border-transparent dark:text-night-text dark:hover:bg-night-surface',
    danger:
      'bg-crimson-800 text-white hover:bg-crimson-900 active:bg-crimson-900 border border-crimson-900 dark:bg-crimson-800 dark:text-white dark:hover:bg-crimson-900 dark:border-crimson-900',
  };

  return (
    <button
      disabled={disabled || isLoading}
      className={`min-h-[64px] w-full px-6 py-4 rounded-2xl font-bold text-base inline-flex items-center justify-center gap-3 transition-transform active:scale-[0.99] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 disabled:opacity-50 disabled:pointer-events-none shadow-md select-none ${variants[variant]} ${className}`}
      {...props}
    >
      {isLoading && <Spinner className="w-5 h-5" />}
      {children}
    </button>
  );
};

export const Card: React.FC<
  React.HTMLAttributes<HTMLDivElement> & {
    children: React.ReactNode;
    className?: string;
  }
> = ({ children, className = '', ...props }) => (
  <div
    className={`rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200/90 dark:border-slate-800 p-5 shadow-sm ${className}`}
    {...props}
  >
    {children}
  </div>
);

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  id,
  className = '',
  ...props
}) => {
  const inputId = id || (label ? `input-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);
  return (
    <div className="w-full space-y-1.5">
      {label && (
        <label
          htmlFor={inputId}
          className="block text-sm font-semibold text-slate-900 dark:text-slate-100"
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 border ${
          error
            ? 'border-crimson-800 dark:border-rose-500'
            : 'border-slate-300 dark:border-slate-700'
        } text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 transition-colors shadow-xs ${className}`}
        {...props}
      />
      {error && (
        <p role="alert" className="text-xs font-semibold text-crimson-800 dark:text-rose-400">
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
          className="pointer-events-auto flex items-center justify-between gap-3 rounded-xl bg-slate-900/95 dark:bg-slate-950/95 backdrop-blur-md text-white px-4 py-3 text-sm shadow-xl border border-slate-700"
        >
          <span className="font-medium">{toast.title}</span>
          <button
            type="button"
            onClick={() => removeToast(toast.id)}
            aria-label="Dismiss notification"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg hover:bg-white/10 dark:hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
          >
            <XIcon className="w-4 h-4" />
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-md p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <h2
            id="saathi-modal-title"
            className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 transition-colors"
          >
            <XIcon className="w-5 h-5" />
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
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-paper/95 dark:bg-night/95 border-t border-line dark:border-night-line grid grid-cols-4 items-stretch pb-safe"
    >
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = location.pathname === item.to;
        return (
          <Link
            key={item.to}
            to={item.to}
            className={`min-h-[48px] flex flex-col items-center justify-center text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 border-t-2 ${
              active
                ? 'border-teal-700 text-teal-700 dark:text-teal-400 dark:border-teal-400 bg-surface/50 dark:bg-night-surface/50'
                : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
            }`}
          >
            <Icon className="w-5 h-5" />
            <span className="mt-1 text-[11px] uppercase tracking-wider">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
};
