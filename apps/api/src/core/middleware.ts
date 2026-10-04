import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { config } from './config';
import { getDb } from './db';
import { ACCESS_COOKIE_NAME, verifyToken } from './security';
import { users, type UserRow, type UserRole } from '../db/schema';

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
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(self), camera=(), microphone=()'
  );
  next();
}

const rateBuckets = new Map<string, number[]>();
const pinSettingsRateBuckets = new Map<string, number[]>();

export function resetRateLimiter(): void {
  rateBuckets.clear();
  pinSettingsRateBuckets.clear();
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

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    let token: string | undefined = req.cookies?.[ACCESS_COOKIE_NAME];
    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.slice(7).trim();
    }

    if (!token) {
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
      res.status(401).json({ detail: 'User account not found' });
      return;
    }

    req.user = user;
    next();
  } catch {
    res.status(401).json({ detail: 'Invalid or expired access token' });
  }
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ detail: 'Not authenticated' });
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ detail: 'Insufficient permissions for this role' });
      return;
    }
    next();
  };
}
