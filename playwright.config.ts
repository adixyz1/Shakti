import { defineConfig, devices } from '@playwright/test';
import os from 'os';
import path from 'path';

const testPort = Number(process.env.PLAYWRIGHT_TEST_PORT || 3456);
const tempDbPath = path.join(
  os.tmpdir(),
  `shakti_playwright_e2e_${process.pid}.db`
);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${testPort}`,
    viewport: { width: 390, height: 844 },
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium-mobile',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  webServer: {
    command: `(test -f dist/index.html || npm run build) && NODE_ENV=test SERVE_STATIC=true DEMO_MODE=true JWT_SECRET=super_secret_jwt_key_for_testing_32_chars! HMAC_SECRET=super_secret_jwt_key_for_testing_32_chars! PORT=${testPort} SAATHI_PORT=${testPort} DATABASE_URL=file:${tempDbPath} ESCALATION_STEP1_DELAY_SECONDS=1 ESCALATION_STEP2_DELAY_SECONDS=2 AUTH_RATE_LIMIT_PER_MINUTE=500 PIN_SETTINGS_RATE_LIMIT_PER_MINUTE=500 CORS_ORIGINS=http://127.0.0.1:${testPort},http://localhost:${testPort} tsx apps/api/server.ts`,
    url: `http://127.0.0.1:${testPort}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
