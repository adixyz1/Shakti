import { create } from 'zustand';
import { demoApi, type DemoStatusDto } from '../lib/api';

interface DemoModeState {
  checked: boolean;
  demoMode: boolean;
  status: DemoStatusDto | null;
  checkDemoMode: () => Promise<boolean>;
  setDemoModeState: (enabled: boolean, status?: DemoStatusDto | null) => void;
}

export const useDemoStore = create<DemoModeState>((set) => ({
  checked: false,
  demoMode: false,
  status: null,

  setDemoModeState: (enabled, status = null) =>
    set({
      checked: true,
      demoMode: enabled,
      status: enabled
        ? status || {
            demo_mode: true,
            banner: 'DEMO MODE: no real alerts are sent',
            providers: {
              sms: { name: 'MockSmsProvider', label: 'MOCK' },
              push: { name: 'MockPushProvider', label: 'MOCK' },
              gateway_112: { name: 'MockEmergencyGateway', label: 'MOCK' },
            },
          }
        : null,
    }),

  checkDemoMode: async () => {
    try {
      const res = await demoApi.getStatus();
      set({
        checked: true,
        demoMode: Boolean(res?.demo_mode),
        status: res,
      });
      return Boolean(res?.demo_mode);
    } catch {
      set({
        checked: true,
        demoMode: false,
        status: null,
      });
      return false;
    }
  },
}));
