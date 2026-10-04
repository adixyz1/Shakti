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

export const config = {
  environment: process.env.ENVIRONMENT || process.env.NODE_ENV || 'development',
  port: Number(process.env.SAATHI_PORT || 3000),
  databaseUrl: normalizeSqliteUrl(process.env.DATABASE_URL),
  jwtSecretKey:
    process.env.JWT_SECRET_KEY || 'saathi-dev-secret-key-change-in-production',
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
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  enableAiAssist: process.env.ENABLE_AI_ASSIST === 'true',
};
