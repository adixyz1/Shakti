import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.shakti.safety',
  appName: 'SHAKTI',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
