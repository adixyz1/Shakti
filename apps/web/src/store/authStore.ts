import { create } from 'zustand';

export type UserRole = 'user' | 'responder' | 'admin';

export interface UserProfile {
  id: string;
  phone_e164: string;
  name: string;
  role: UserRole;
  language: 'en' | 'hi';
  created_at: string;
  cancel_window_seconds?: number;
  has_cancel_pin?: boolean;
  has_duress_pin?: boolean;
}

export interface ToastMessage {
  id: string;
  title: string;
  variant?: 'info' | 'success' | 'warning' | 'error';
}

interface AuthState {
  user: UserProfile | null;
  isLoading: boolean;
  darkMode: boolean;
  toasts: ToastMessage[];
  setUser: (user: UserProfile | null) => void;
  setLoading: (loading: boolean) => void;
  toggleDarkMode: () => void;
  addToast: (title: string, variant?: ToastMessage['variant']) => void;
  removeToast: (id: string) => void;
}

const initialDark =
  typeof window !== 'undefined'
    ? window.localStorage.getItem('saathi_theme') === 'dark'
    : false;

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  darkMode: initialDark,
  toasts: [],
  setUser: (user) => set({ user, isLoading: false }),
  setLoading: (isLoading) => set({ isLoading }),
  toggleDarkMode: () =>
    set((state) => {
      const next = !state.darkMode;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('saathi_theme', next ? 'dark' : 'light');
        document.documentElement.classList.toggle('dark', next);
      }
      return { darkMode: next };
    }),
  addToast: (title, variant = 'info') =>
    set((state) => ({
      toasts: [
        ...state.toasts,
        { id: `${Date.now()}-${Math.random()}`, title, variant },
      ],
    })),
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}));
