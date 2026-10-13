import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { Response } from 'express';
import { config } from './config';
import type { UserRole } from '../db/schema';

export const ACCESS_COOKIE_NAME = 'saathi_access_token';
export const REFRESH_COOKIE_NAME = 'saathi_refresh_token';

const PHONE_E164_REGEX = /\+[1-9]\d{6,14}/g;
const JWT_REGEX = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const INVITE_TOKEN_REGEX = /inv_[A-Za-z0-9_]+\.[A-Za-z0-9_]+/g;
const CONTACT_ALERT_TOKEN_REGEX = /ctk_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const COORD_PAIR_REGEX = /-?\d{1,2}\.\d{3,8}\s*,\s*-?\d{1,3}\.\d{3,8}/g;
const PIN_JSON_REGEX = /"(?:pin|cancel_pin|duress_pin)"\s*:\s*"[^"]*"/gi;

export function redactPII(text: string): string {
  return text
    .replace(PHONE_E164_REGEX, '[REDACTED_PHONE]')
    .replace(JWT_REGEX, '[REDACTED_TOKEN]')
    .replace(INVITE_TOKEN_REGEX, '[REDACTED_TOKEN]')
    .replace(CONTACT_ALERT_TOKEN_REGEX, '[REDACTED_TOKEN]')
    .replace(COORD_PAIR_REGEX, '[REDACTED_COORDS]')
    .replace(PIN_JSON_REGEX, '"pin":"[REDACTED_PIN]"');
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>) {
    const payload = JSON.stringify({
      level: 'INFO',
      timestamp: new Date().toISOString(),
      message: redactPII(message),
      ...(meta ? JSON.parse(redactPII(JSON.stringify(meta))) : {}),
    });
    console.log(payload);
  },
  warn(message: string, meta?: Record<string, unknown>) {
    const payload = JSON.stringify({
      level: 'WARN',
      timestamp: new Date().toISOString(),
      message: redactPII(message),
      ...(meta ? JSON.parse(redactPII(JSON.stringify(meta))) : {}),
    });
    console.warn(payload);
  },
  error(message: string, meta?: Record<string, unknown>) {
    const payload = JSON.stringify({
      level: 'ERROR',
      timestamp: new Date().toISOString(),
      message: redactPII(message),
      ...(meta ? JSON.parse(redactPII(JSON.stringify(meta))) : {}),
    });
    console.error(payload);
  },
};

export function hashOtpCode(phoneE164: string, code: string): string {
  return crypto
    .createHmac('sha256', config.jwtSecretKey)
    .update(`${phoneE164}:${code}`)
    .digest('hex');
}

export function verifyOtpCodeHash(
  phoneE164: string,
  code: string,
  expectedHash: string
): boolean {
  const candidate = hashOtpCode(phoneE164, code);
  const candidateBuf = Buffer.from(candidate, 'hex');
  const expectedBuf = Buffer.from(expectedHash, 'hex');
  if (candidateBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(candidateBuf, expectedBuf);
}

const SCRYPT_PARAMS: crypto.ScryptOptions = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024,
};
const SCRYPT_KEYLEN = 64;

function scryptAsync(
  password: string,
  salt: string,
  keylen: number,
  options: crypto.ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) {
        reject(err);
      } else {
        resolve(derivedKey);
      }
    });
  });
}

async function hashPinWithScrypt(
  scope: 'cancel' | 'duress',
  userId: string,
  pin: string
): Promise<string> {
  const randomSalt = crypto.randomBytes(16).toString('hex');
  const fullSalt = `${scope}:${userId}:${randomSalt}:${config.jwtSecretKey}`;
  const derivedKey = await scryptAsync(
    pin,
    fullSalt,
    SCRYPT_KEYLEN,
    SCRYPT_PARAMS
  );
  return `scrypt$${randomSalt}$${derivedKey.toString('hex')}`;
}

async function verifyPinWithScrypt(
  scope: 'cancel' | 'duress',
  userId: string,
  pin: string,
  storedHash: string
): Promise<boolean> {
  if (!storedHash || !storedHash.startsWith('scrypt$')) {
    return false;
  }
  const parts = storedHash.split('$');
  if (parts.length !== 3) {
    return false;
  }
  const [, randomSalt, expectedHex] = parts;
  if (!randomSalt || !expectedHex) {
    return false;
  }
  const fullSalt = `${scope}:${userId}:${randomSalt}:${config.jwtSecretKey}`;
  const derivedKey = await scryptAsync(
    pin,
    fullSalt,
    SCRYPT_KEYLEN,
    SCRYPT_PARAMS
  );
  const candidateHex = derivedKey.toString('hex');

  const candidateBuf = Buffer.from(candidateHex, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (candidateBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(candidateBuf, expectedBuf);
}

export async function hashCancelPin(
  userId: string,
  pin: string
): Promise<string> {
  return hashPinWithScrypt('cancel', userId, pin);
}

export async function verifyCancelPinHash(
  userId: string,
  pin: string,
  expectedHash: string
): Promise<boolean> {
  return verifyPinWithScrypt('cancel', userId, pin, expectedHash);
}

export async function hashDuressPin(
  userId: string,
  pin: string
): Promise<string> {
  return hashPinWithScrypt('duress', userId, pin);
}

export async function verifyDuressPinHash(
  userId: string,
  pin: string,
  expectedHash: string
): Promise<boolean> {
  return verifyPinWithScrypt('duress', userId, pin, expectedHash);
}

export interface TokenPayload {
  sub: string;
  role: UserRole;
  type: 'access' | 'refresh';
  iat?: number;
  exp?: number;
}

export function createAccessToken(userId: string, role: UserRole): string {
  return jwt.sign(
    { sub: userId, role, type: 'access' },
    config.jwtSecretKey,
    {
      algorithm: config.jwtAlgorithm,
      expiresIn: `${config.accessTokenExpireMinutes}m`,
    }
  );
}

export function createRefreshToken(userId: string, role: UserRole): string {
  return jwt.sign(
    { sub: userId, role, type: 'refresh' },
    config.jwtSecretKey,
    {
      algorithm: config.jwtAlgorithm,
      expiresIn: `${config.refreshTokenExpireDays}d`,
    }
  );
}

export function verifyToken(
  token: string,
  expectedType: 'access' | 'refresh'
): TokenPayload {
  const decoded = jwt.verify(token, config.jwtSecretKey, {
    algorithms: [config.jwtAlgorithm],
  }) as TokenPayload;

  if (decoded.type !== expectedType || !decoded.sub) {
    throw new Error('Invalid token type');
  }
  return decoded;
}

export function setAuthCookies(res: Response, userId: string, role: UserRole): void {
  const accessToken = createAccessToken(userId, role);
  const refreshToken = createRefreshToken(userId, role);
  const isProd =
    process.env.NODE_ENV === 'production' ||
    process.env.ENVIRONMENT === 'production' ||
    config.environment === 'production';

  res.cookie(ACCESS_COOKIE_NAME, accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: config.accessTokenExpireMinutes * 60 * 1000,
    path: '/',
  });

  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: config.refreshTokenExpireDays * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE_NAME, { path: '/' });
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/' });
}

export function hashInvitationToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createSignedInvitationToken(): {
  token: string;
  tokenHash: string;
} {
  const nonce = crypto.randomBytes(24).toString('hex');
  const signature = crypto
    .createHmac('sha256', config.jwtSecretKey)
    .update(`inv:${nonce}`)
    .digest('hex');
  const token = `inv_${nonce}.${signature}`;
  return {
    token,
    tokenHash: hashInvitationToken(token),
  };
}

export function verifyAndHashInvitationToken(token: string): string | null {
  if (!token || !token.startsWith('inv_')) {
    return null;
  }
  const parts = token.slice(4).split('.');
  if (parts.length !== 2) {
    return null;
  }
  const [nonce, sig] = parts;
  if (!nonce || !sig) {
    return null;
  }
  const expectedSig = crypto
    .createHmac('sha256', config.jwtSecretKey)
    .update(`inv:${nonce}`)
    .digest('hex');

  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expectedSig, 'hex');
  if (sigBuf.length !== expectedBuf.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  return hashInvitationToken(token);
}

export function hashContactIncidentToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createSignedContactIncidentToken(
  incidentId: string,
  contactId: string
): {
  token: string;
  tokenHash: string;
} {
  const nonce = crypto.randomBytes(24).toString('hex');
  const signature = crypto
    .createHmac('sha256', config.jwtSecretKey)
    .update(`ctk:${incidentId}:${contactId}:${nonce}`)
    .digest('hex');
  const token = `ctk_${nonce}.${signature}`;
  return {
    token,
    tokenHash: hashContactIncidentToken(token),
  };
}

export function verifyContactIncidentTokenSignature(
  token: string,
  incidentId: string,
  contactId: string
): boolean {
  if (!token || !token.startsWith('ctk_')) {
    return false;
  }
  const parts = token.slice(4).split('.');
  if (parts.length !== 2) {
    return false;
  }
  const [nonce, sig] = parts;
  if (!nonce || !sig) {
    return false;
  }
  const expectedSig = crypto
    .createHmac('sha256', config.jwtSecretKey)
    .update(`ctk:${incidentId}:${contactId}:${nonce}`)
    .digest('hex');

  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expectedSig, 'hex');
  if (sigBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(sigBuf, expectedBuf);
}

export function parseAndHashContactIncidentToken(token: string): string | null {
  if (!token || !token.startsWith('ctk_')) {
    return null;
  }
  const parts = token.slice(4).split('.');
  if (parts.length !== 2) {
    return null;
  }
  const [nonce, sig] = parts;
  if (!nonce || !sig) {
    return null;
  }
  return hashContactIncidentToken(token);
}

