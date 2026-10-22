import dotenv from 'dotenv';

dotenv.config();

function normalizeSqliteUrl(rawUrl: string | undefined): string {
  if (!rawUrl) {
    return 'file:./saathi.db';
  }
  if (rawUrl.startsWith('sqlite+aiosqlite:///')) {
    const filePath = rawUrl.replace('sqlite+aiosqlite:///', '');
    return `file:${filePath}`;
  }
  if (rawUrl.startsWith('file:') || rawUrl === ':memory:') {
    return rawUrl;
  }
  return `file:${rawUrl}`;
}

export const DEFAULT_DEV_JWT_SECRET =
  'saathi-dev-secret-key-change-in-production';
export const DEFAULT_DEV_HMAC_SECRET =
  'saathi-dev-secret-key-change-in-production';

export function isBuiltinOrInsecureSecret(secret: string): boolean {
  const s = (secret || '').trim().toLowerCase();
  if (
    s === DEFAULT_DEV_JWT_SECRET.toLowerCase() ||
    s.includes('do-not-use-in-prod') ||
    s.includes('change-in-production') ||
    s.includes('dev-secret')
  ) {
    return true;
  }
  return false;
}

export function assertValidDemoModeConfiguration(
  env: NodeJS.ProcessEnv = process.env
): void {
  const nodeEnv = (env.NODE_ENV || env.ENVIRONMENT || 'development').trim();
  const demoFlag = (env.DEMO_MODE || '').trim().toLowerCase() === 'true';
  if (demoFlag && nodeEnv === 'production') {
    throw new Error(
      'FATAL: DEMO_MODE=true is forbidden when NODE_ENV=production. Refusing to start server with demo mode enabled in production.'
    );
  }
}

export function assertValidProductionConfiguration(
  env: NodeJS.ProcessEnv = process.env
): void {
  assertValidDemoModeConfiguration(env);

  const nodeEnv = (env.NODE_ENV || env.ENVIRONMENT || 'development').trim().toLowerCase();
  const isDemo = (env.DEMO_MODE || '').trim().toLowerCase() === 'true';
  const isCookieSecure =
    (env.COOKIE_SECURE || '').trim().toLowerCase() === 'true' ||
    (env.COOKIE_SECURE || '').trim() === '1';
  const isProd = nodeEnv === 'production';

  const requiresStrongSecrets = isProd || isDemo || isCookieSecure;

  if (requiresStrongSecrets) {
    const rawJwt = env.JWT_SECRET_KEY !== undefined ? env.JWT_SECRET_KEY : env.JWT_SECRET;
    const jwtSecret = (rawJwt || '').trim();

    if (!jwtSecret || jwtSecret.length < 32 || isBuiltinOrInsecureSecret(jwtSecret)) {
      throw new Error(
        'FATAL: JWT_SECRET / JWT_SECRET_KEY is missing, uses the default development secret, or is shorter than 32 characters.'
      );
    }

    const rawHmac = env.HMAC_SECRET_KEY !== undefined ? env.HMAC_SECRET_KEY : env.HMAC_SECRET;
    const hmacSecret = (rawHmac !== undefined ? rawHmac : jwtSecret).trim();

    if (!hmacSecret || hmacSecret.length < 32 || isBuiltinOrInsecureSecret(hmacSecret)) {
      throw new Error(
        'FATAL: HMAC_SECRET / HMAC_SECRET_KEY is missing, uses the default development secret, or is shorter than 32 characters.'
      );
    }
  }

  if (isProd) {
    const otpProviderName = (env.OTP_PROVIDER || 'mock').trim().toLowerCase();
    const allowMockProviders =
      (env.ALLOW_MOCK_PROVIDERS || '').trim().toLowerCase() === 'true';
    if (
      (otpProviderName === 'mock' || otpProviderName === 'mockotpprovider') &&
      !allowMockProviders
    ) {
      throw new Error(
        'FATAL: MockOtpProvider is active in NODE_ENV=production without explicit ALLOW_MOCK_PROVIDERS=true.'
      );
    }
  }
}

export function isDemoModeEnabled(overrideDemoMode?: boolean): boolean {
  if (typeof overrideDemoMode === 'boolean') {
    return overrideDemoMode;
  }
  const raw = process.env.DEMO_MODE;
  if (raw !== undefined) {
    return raw.trim().toLowerCase() === 'true';
  }
  return Boolean(config.demoMode);
}

export function isTrustProxyEnabled(): boolean {
  const tp = (process.env.TRUST_PROXY || '').trim().toLowerCase();
  return tp === '1' || tp === 'true';
}

export function isCookieSecure(): boolean {
  const cs = (process.env.COOKIE_SECURE || '').trim().toLowerCase();
  if (cs === 'true' || cs === '1') {
    return true;
  }
  const nodeEnv = (process.env.NODE_ENV || process.env.ENVIRONMENT || config?.environment || 'development').trim();
  return nodeEnv === 'production';
}

export const config = {
  environment: process.env.ENVIRONMENT || process.env.NODE_ENV || 'development',
  demoMode: (process.env.DEMO_MODE || '').trim().toLowerCase() === 'true',
  port: Number(process.env.PORT || process.env.SAATHI_PORT || 3000),
  databaseUrl: normalizeSqliteUrl(process.env.DATABASE_URL),
  jwtSecretKey:
    process.env.JWT_SECRET_KEY ||
    process.env.JWT_SECRET ||
    'saathi-dev-secret-key-change-in-production',
  jwtAlgorithm: 'HS256' as const,
  accessTokenExpireMinutes: Number(process.env.ACCESS_TOKEN_EXPIRE_MINUTES || 15),
  refreshTokenExpireDays: Number(process.env.REFRESH_TOKEN_EXPIRE_DAYS || 7),
  otpExpireSeconds: Number(process.env.OTP_EXPIRE_SECONDS || 300),
  otpMaxAttempts: Number(process.env.OTP_MAX_ATTEMPTS || 3),
  authRateLimitPerMinute: Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE || 10),
  duplicateIncidentWindowSeconds: Number(
    process.env.DUPLICATE_INCIDENT_WINDOW_SECONDS || 180
  ),
  incidentAutoExpireMinutes: Number(
    process.env.INCIDENT_AUTO_EXPIRE_MINUTES || 60
  ),
  locationRetentionDays: Number(process.env.LOCATION_RETENTION_DAYS || 7),
  pinMaxAttemptsPerIncident: Number(
    process.env.PIN_MAX_ATTEMPTS_PER_INCIDENT || 5
  ),
  pinSettingsRateLimitPerMinute: Number(
    process.env.PIN_SETTINGS_RATE_LIMIT_PER_MINUTE || 10
  ),
  escalationStep1DelaySeconds: Number(
    process.env.ESCALATION_STEP1_DELAY_SECONDS || 30
  ),
  escalationStep2DelaySeconds: Number(
    process.env.ESCALATION_STEP2_DELAY_SECONDS || 60
  ),
  notificationMaxAttempts: Number(process.env.NOTIFICATION_MAX_ATTEMPTS || 3),
  notificationRetryBaseDelayMs: Number(
    process.env.NOTIFICATION_RETRY_BASE_DELAY_MS || 50
  ),
  retentionPurgeIntervalMs: Number(
    process.env.RETENTION_PURGE_INTERVAL_MS || 3600_000
  ),
  journeyReminderLeadMinutes: Number(
    process.env.JOURNEY_REMINDER_LEAD_MINUTES || 3
  ),
  safetyLayerMinReportsK: Number(
    process.env.SAFETY_LAYER_MIN_REPORTS_K || 5
  ),
  reportRateLimitPerMinute: Number(
    process.env.REPORT_RATE_LIMIT_PER_MINUTE || 10
  ),
  reportDailyCapPerReporter: Number(
    process.env.REPORT_DAILY_CAP_PER_REPORTER || 5
  ),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  enableAiAssist: process.env.ENABLE_AI_ASSIST === 'true',
};
