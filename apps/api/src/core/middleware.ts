import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { config, isAllowedCorsOrigin, isDemoModeEnabled } from './config';
import { getDb } from './db';
import {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  verifyToken,
} from './security';
import { users, type UserRow, type UserRole } from '../db/schema';

export function isZeroAuthDemoAllowed(): boolean {
  const isTestEnv =
    process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  const isProdEnv =
    (process.env.NODE_ENV || process.env.ENVIRONMENT || '')
      .trim()
      .toLowerCase() === 'production';
  if (isTestEnv || isProdEnv) {
    return false;
  }
  return isDemoModeEnabled();
}

export function corsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const originHeader = req.headers.origin;
  if (typeof originHeader === 'string' && originHeader.trim()) {
    const cleanOrigin = originHeader.trim();
    if (isAllowedCorsOrigin(cleanOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', cleanOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader(
        'Access-Control-Allow-Methods',
        'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS'
      );
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Demo-Role, Accept'
      );
    }
  }
  if (req.method.toUpperCase() === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

declare global {
  namespace Express {
    interface Request {
      user?: UserRow;
    }
  }
}

export function securityHeadersMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(self), camera=(), microphone=()'
  );

  const isTest =
    process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  const isDev = process.env.NODE_ENV !== 'production';

  if (!isTest && isDev) {
    // Development mode in AI Studio environment (preview rendered within iframe):
    // Allow embedding from iframe ancestors and permit Vite development scripts and styles
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org; connect-src 'self' ws: wss: http: https:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors *"
    );
  } else {
    // Production & Test mode: enforce strict anti-clickjacking headers
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org; connect-src 'self' ws: wss:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    );
  }
  next();
}

const PUBLIC_OR_TOKEN_MUTATION_REGEX =
  /^\/(?:api\/)?(?:auth\/otp\/(?:request|verify)|invitations\/[^/]+\/(?:accept|decline)|c\/[^/]+\/respond)\/?$/i;

export function csrfProtectionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    next();
    return;
  }

  // Public or token-based state-changing routes do not authenticate via cookies
  const reqPath = (req.originalUrl || req.url || '').split('?')[0];
  if (PUBLIC_OR_TOKEN_MUTATION_REGEX.test(reqPath)) {
    next();
    return;
  }

  if (isZeroAuthDemoAllowed() && req.headers['x-demo-role']) {
    next();
    return;
  }

  // Enforce CSRF Origin/Host check when cookie-based auth is present and no Bearer token header is used
  const hasAuthCookie = Boolean(
    req.cookies?.[ACCESS_COOKIE_NAME] || req.cookies?.[REFRESH_COOKIE_NAME]
  );
  const hasBearerAuth = Boolean(req.headers.authorization?.startsWith('Bearer '));
  if (!hasAuthCookie || hasBearerAuth) {
    next();
    return;
  }

  const originHeader = req.headers.origin;
  const refererHeader = req.headers.referer;
  const sourceUrl =
    typeof originHeader === 'string' && originHeader.trim()
      ? originHeader.trim()
      : typeof refererHeader === 'string' && refererHeader.trim()
        ? refererHeader.trim()
        : null;

  if (!sourceUrl) {
    res.status(403).json({
      detail:
        'CSRF validation failed: Origin or Referer header is required for cookie-authenticated state-changing requests.',
    });
    return;
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(sourceUrl);
  } catch {
    res.status(403).json({
      detail: 'CSRF validation failed: malformed Origin or Referer header.',
    });
    return;
  }

  const trustProxy = Boolean(
    req.app?.get?.('trust proxy') ||
    (process.env.TRUST_PROXY || '').trim() === '1' ||
    (process.env.TRUST_PROXY || '').trim().toLowerCase() === 'true'
  );

  const rawForwardedHost =
    typeof req.headers['x-forwarded-for'] === 'string' ||
    typeof req.headers['x-forwarded-host'] === 'string'
      ? (req.headers['x-forwarded-host'] as string | undefined)
          ?.split(',')[0]
          .trim()
      : undefined;

  const effectiveHost = (
    (trustProxy && rawForwardedHost ? rawForwardedHost : req.headers.host) || ''
  )
    .trim()
    .toLowerCase();

  const originHost = parsedOrigin.host.toLowerCase();
  const originBase = `${parsedOrigin.protocol}//${parsedOrigin.host}`.toLowerCase();

  if (
    (effectiveHost && originHost === effectiveHost) ||
    isAllowedCorsOrigin(originBase)
  ) {
    next();
    return;
  }

  res.status(403).json({
    detail: 'CSRF validation failed: cross-origin state-changing request rejected.',
  });
}

const rateBuckets = new Map<string, number[]>();
const pinSettingsRateBuckets = new Map<string, number[]>();
const contactResponseRateBuckets = new Map<string, number[]>();
const reportRateBuckets = new Map<string, number[]>();
const reportDailyCapBuckets = new Map<string, number[]>();
const safetyToolsRateBuckets = new Map<string, number[]>();

export function resetRateLimiter(): void {
  rateBuckets.clear();
  pinSettingsRateBuckets.clear();
  contactResponseRateBuckets.clear();
  reportRateBuckets.clear();
  reportDailyCapBuckets.clear();
  safetyToolsRateBuckets.clear();
}

export function reportRateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Key strictly by IP so anonymous submissions are never linked to user_id in rate limiter buckets
  const forwardedIp =
    typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',')[0].trim()
      : req.ip;
  const clientKey = forwardedIp || 'unknown';
  const now = Date.now();
  const windowMs = 60_000;
  const maxRequests = config.reportRateLimitPerMinute;

  const timestamps = (reportRateBuckets.get(clientKey) || []).filter(
    (t) => now - t < windowMs
  );

  if (timestamps.length >= maxRequests) {
    res.status(429).json({
      detail: 'Too many safety reports submitted. Please wait a minute and try again.',
    });
    return;
  }

  timestamps.push(now);
  reportRateBuckets.set(clientKey, timestamps);
  next();
}

export function checkAndRecordReportDailyCap(
  isAnonymous: boolean,
  userId: string | undefined,
  ipAddress: string | undefined
): boolean {
  const now = Date.now();
  const dayWindowMs = 24 * 60 * 60 * 1000;
  const maxDaily = config.reportDailyCapPerReporter;

  // Per IP for anonymous reports (in memory only, never stored on report); per account for signed-in non-anonymous reports
  const bucketKey = isAnonymous
    ? `anon_ip:${ipAddress || 'unknown'}`
    : `acct:${userId || 'unknown'}`;

  const timestamps = (reportDailyCapBuckets.get(bucketKey) || []).filter(
    (t) => now - t < dayWindowMs
  );

  if (timestamps.length >= maxDaily) {
    return false;
  }

  timestamps.push(now);
  reportDailyCapBuckets.set(bucketKey, timestamps);
  return true;
}

export function contactResponseRateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const tokenKey = String(req.params.token || req.ip || 'unknown');
  const now = Date.now();
  const windowMs = 60_000;
  const maxRequests = 15;

  const timestamps = (contactResponseRateBuckets.get(tokenKey) || []).filter(
    (t) => now - t < windowMs
  );

  if (timestamps.length >= maxRequests) {
    res.status(429).json({
      detail: 'Too many responses submitted. Please wait a moment and try again.',
    });
    return;
  }

  timestamps.push(now);
  contactResponseRateBuckets.set(tokenKey, timestamps);
  next();
}

export function pinSettingsRateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const clientKey = req.user?.id || req.ip || 'unknown';
  const now = Date.now();
  const windowMs = 60_000;
  const maxRequests = config.pinSettingsRateLimitPerMinute;

  const timestamps = (pinSettingsRateBuckets.get(clientKey) || []).filter(
    (t) => now - t < windowMs
  );

  if (timestamps.length >= maxRequests) {
    res.status(429).json({
      detail: 'Too many PIN configuration requests. Please wait a minute and try again.',
    });
    return;
  }

  timestamps.push(now);
  pinSettingsRateBuckets.set(clientKey, timestamps);
  next();
}

export function authRateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const clientKey = req.ip || 'unknown';
  const now = Date.now();
  const windowMs = 60_000;
  const maxRequests = config.authRateLimitPerMinute;

  const timestamps = (rateBuckets.get(clientKey) || []).filter(
    (t) => now - t < windowMs
  );

  if (timestamps.length >= maxRequests) {
    res.status(429).json({
      detail: 'Too many authentication requests. Please wait a minute and try again.',
    });
    return;
  }

  timestamps.push(now);
  rateBuckets.set(clientKey, timestamps);
  next();
}

async function resolveFallbackDemoAccount(
  preferredRole?: string
): Promise<UserRow | undefined> {
  const db = getDb();
  const role =
    preferredRole === 'responder' || preferredRole === 'admin'
      ? preferredRole
      : 'user';
  const demoPhone =
    role === 'responder'
      ? '+919000000002'
      : role === 'admin'
        ? '+919000000003'
        : '+919000000001';

  const [byPhone] = await db
    .select()
    .from(users)
    .where(eq(users.phoneE164, demoPhone))
    .limit(1);
  if (byPhone) return byPhone;

  const [byRole] = await db
    .select()
    .from(users)
    .where(eq(users.role, role))
    .limit(1);
  return byRole;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const allowDemoFallback = isZeroAuthDemoAllowed();
  const demoRoleHeader =
    typeof req.headers['x-demo-role'] === 'string'
      ? req.headers['x-demo-role'].trim().toLowerCase()
      : undefined;

  try {
    if (allowDemoFallback && demoRoleHeader) {
      const demoUser = await resolveFallbackDemoAccount(demoRoleHeader);
      if (demoUser) {
        req.user = demoUser;
        next();
        return;
      }
    }

    let token: string | undefined = req.cookies?.[ACCESS_COOKIE_NAME];
    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.slice(7).trim();
    }

    if (!token) {
      if (allowDemoFallback) {
        const demoUser = await resolveFallbackDemoAccount(demoRoleHeader);
        if (demoUser) {
          req.user = demoUser;
          next();
          return;
        }
      }
      res.status(401).json({ detail: 'Not authenticated' });
      return;
    }

    const payload = verifyToken(token, 'access');
    const db = getDb();
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);

    if (!user) {
      if (allowDemoFallback) {
        const demoUser = await resolveFallbackDemoAccount(demoRoleHeader);
        if (demoUser) {
          req.user = demoUser;
          next();
          return;
        }
      }
      res.status(401).json({ detail: 'User account not found' });
      return;
    }

    req.user = user;
    next();
  } catch {
    if (allowDemoFallback) {
      try {
        const demoUser = await resolveFallbackDemoAccount(demoRoleHeader);
        if (demoUser) {
          req.user = demoUser;
          next();
          return;
        }
      } catch {
        // ignore fallback lookup error
      }
    }
    res.status(401).json({ detail: 'Invalid or expired access token' });
  }
}

export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const allowDemoFallback = isZeroAuthDemoAllowed();
  const demoRoleHeader =
    typeof req.headers['x-demo-role'] === 'string'
      ? req.headers['x-demo-role'].trim().toLowerCase()
      : undefined;

  try {
    if (allowDemoFallback && demoRoleHeader) {
      const demoUser = await resolveFallbackDemoAccount(demoRoleHeader);
      if (demoUser) {
        req.user = demoUser;
        next();
        return;
      }
    }

    let token: string | undefined = req.cookies?.[ACCESS_COOKIE_NAME];
    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.slice(7).trim();
    }

    if (token) {
      const payload = verifyToken(token, 'access');
      const db = getDb();
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, payload.sub))
        .limit(1);

      if (user) {
        req.user = user;
      }
    } else if (allowDemoFallback) {
      const demoUser = await resolveFallbackDemoAccount(demoRoleHeader);
      if (demoUser) {
        req.user = demoUser;
      }
    }
  } catch {
    // optional auth ignores invalid/expired tokens and proceeds without req.user
  }
  next();
}

export function requireRole(...allowedRoles: UserRole[]) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const allowDemoFallback = isZeroAuthDemoAllowed();

    if (!req.user) {
      if (allowDemoFallback && allowedRoles.length > 0) {
        const demoUser = await resolveFallbackDemoAccount(allowedRoles[0]);
        if (demoUser) {
          req.user = demoUser;
          next();
          return;
        }
      }
      res.status(401).json({ detail: 'Not authenticated' });
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      if (allowDemoFallback && allowedRoles.length > 0) {
        const demoUser = await resolveFallbackDemoAccount(allowedRoles[0]);
        if (demoUser) {
          req.user = demoUser;
          next();
          return;
        }
      }
      res.status(403).json({ detail: 'Insufficient permissions for this role' });
      return;
    }
    next();
  };
}

export function safetyToolsRateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const forwardedIp =
    typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',')[0].trim()
      : req.ip;
  const clientKey = forwardedIp || 'unknown';
  const now = Date.now();
  const windowMs = 60_000;
  const maxRequests = 60; // 60 req/min per IP
  const timestamps = (safetyToolsRateBuckets.get(clientKey) || []).filter(
    (t) => now - t < windowMs
  );
  if (timestamps.length >= maxRequests) {
    res.status(429).json({
      detail: 'Too many safety tool requests. Please wait a minute and try again.',
    });
    return;
  }
  timestamps.push(now);
  safetyToolsRateBuckets.set(clientKey, timestamps);
  next();
}

