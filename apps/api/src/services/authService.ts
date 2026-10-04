import crypto from 'crypto';
import { desc, eq } from 'drizzle-orm';
import { config } from '../core/config';
import type { AppDatabase } from '../core/db';
import { hashOtpCode, verifyOtpCodeHash, logger } from '../core/security';
import { otpCodes, users, type UserRow } from '../db/schema';
import { defaultOtpProvider, type OtpProvider } from '../providers/otp';
import type { UserResponseDto } from '../schemas/auth';

export class HttpError extends Error {
  public readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function toUserResponseDto(user: UserRow): UserResponseDto {
  return {
    id: user.id,
    phone_e164: user.phoneE164,
    name: user.name,
    role: user.role,
    language: user.language,
    cancel_window_seconds: user.cancelWindowSeconds ?? 5,
    has_cancel_pin: Boolean(user.cancelPinHash),
    has_duress_pin: Boolean(user.duressPinHash),
    created_at: user.createdAt,
  };
}

export async function requestOtpForPhone(
  db: AppDatabase,
  phoneE164: string,
  otpProvider: OtpProvider = defaultOtpProvider,
  customExpiresInSeconds?: number
): Promise<{
  status: string;
  provider: string;
  expires_in_seconds: number;
  dev_mock_hint: string | null;
}> {
  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = hashOtpCode(phoneE164, code);
  const ttlSeconds = customExpiresInSeconds ?? config.otpExpireSeconds;
  const expiresAt = Date.now() + ttlSeconds * 1000;

  await db.delete(otpCodes).where(eq(otpCodes.phoneE164, phoneE164));

  await db.insert(otpCodes).values({
    id: crypto.randomUUID(),
    phoneE164,
    codeHash,
    expiresAt,
    attempts: 0,
    createdAt: new Date().toISOString(),
  });

  await otpProvider.sendOtp(phoneE164, code);

  return {
    status: 'otp_sent',
    provider: otpProvider.providerName,
    expires_in_seconds: ttlSeconds,
    dev_mock_hint: config.environment !== 'production' ? code : null,
  };
}

export async function verifyOtpForPhone(
  db: AppDatabase,
  params: { phone_e164: string; code: string; name?: string }
): Promise<UserRow> {
  const { phone_e164: phoneE164, code, name } = params;

  const [otpRecord] = await db
    .select()
    .from(otpCodes)
    .where(eq(otpCodes.phoneE164, phoneE164))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);

  if (!otpRecord) {
    throw new HttpError(400, 'No active OTP found for this phone number.');
  }

  if (Date.now() > otpRecord.expiresAt) {
    await db.delete(otpCodes).where(eq(otpCodes.id, otpRecord.id));
    throw new HttpError(400, 'OTP code has expired. Please request a new code.');
  }

  if (otpRecord.attempts >= config.otpMaxAttempts) {
    throw new HttpError(
      429,
      'Maximum OTP verification attempts exceeded. Please request a new code.'
    );
  }

  const isValid = verifyOtpCodeHash(phoneE164, code, otpRecord.codeHash);
  if (!isValid) {
    const nextAttempts = otpRecord.attempts + 1;
    await db
      .update(otpCodes)
      .set({ attempts: nextAttempts })
      .where(eq(otpCodes.id, otpRecord.id));

    if (nextAttempts >= config.otpMaxAttempts) {
      logger.warn(`OTP lockout triggered for ${phoneE164} after ${nextAttempts} attempts`);
      throw new HttpError(
        429,
        'Maximum OTP verification attempts exceeded. Please request a new code.'
      );
    }

    throw new HttpError(400, 'Invalid OTP code.');
  }

  // Consume OTP record on success
  await db.delete(otpCodes).where(eq(otpCodes.id, otpRecord.id));

  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.phoneE164, phoneE164))
    .limit(1);

  if (existingUser) {
    if (name && name.trim() && existingUser.name === 'SAATHI User') {
      await db
        .update(users)
        .set({ name: name.trim() })
        .where(eq(users.id, existingUser.id));
      return { ...existingUser, name: name.trim() };
    }
    return existingUser;
  }

  const newUser: UserRow = {
    id: crypto.randomUUID(),
    phoneE164,
    name: name?.trim() || 'SAATHI User',
    role: 'user',
    language: 'en',
    cancelWindowSeconds: 5,
    cancelPinHash: null,
    duressPinHash: null,
    createdAt: new Date().toISOString(),
  };

  await db.insert(users).values(newUser);
  logger.info(`Created new user account for ${phoneE164}`);
  return newUser;
}
