import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { getDb } from '../core/db';
import {
  authRateLimitMiddleware,
  requireAuth,
  requireRole,
} from '../core/middleware';
import {
  clearAuthCookies,
  REFRESH_COOKIE_NAME,
  setAuthCookies,
  verifyToken,
} from '../core/security';
import { users } from '../db/schema';
import {
  deleteAccountSchema,
  otpRequestSchema,
  otpVerifySchema,
  updateMeSchema,
} from '../schemas/auth';
import {
  HttpError,
  requestOtpForPhone,
  toUserResponseDto,
  verifyOtpForPhone,
} from '../services/authService';
import {
  deleteUserAccount,
  exportUserData,
} from '../services/privacyService';

export const apiRouter = Router();

apiRouter.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'saathi-api',
    runtime: 'node-express-sqlite-drizzle',
  });
});

apiRouter.post(
  '/auth/otp/request',
  authRateLimitMiddleware,
  async (req: Request, res: Response) => {
    const parsed = otpRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        detail: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }

    try {
      const db = getDb();
      const result = await requestOtpForPhone(db, parsed.data.phone_e164);
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
);

apiRouter.post(
  '/auth/otp/verify',
  authRateLimitMiddleware,
  async (req: Request, res: Response) => {
    const parsed = otpVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        detail: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }

    try {
      const db = getDb();
      const user = await verifyOtpForPhone(db, parsed.data);
      setAuthCookies(res, user.id, user.role);
      res.status(200).json(toUserResponseDto(user));
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
);

apiRouter.post('/auth/refresh', async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!refreshToken) {
      res.status(401).json({ detail: 'Missing refresh token' });
      return;
    }

    const payload = verifyToken(refreshToken, 'refresh');
    const db = getDb();
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);

    if (!user) {
      clearAuthCookies(res);
      res.status(401).json({ detail: 'User not found' });
      return;
    }

    setAuthCookies(res, user.id, user.role);
    res.status(200).json(toUserResponseDto(user));
  } catch {
    clearAuthCookies(res);
    res.status(401).json({ detail: 'Invalid or expired refresh token' });
  }
});

apiRouter.post('/auth/logout', (_req: Request, res: Response) => {
  clearAuthCookies(res);
  res.status(200).json({ status: 'logged_out' });
});

apiRouter.get('/me', requireAuth, (req: Request, res: Response) => {
  res.status(200).json(toUserResponseDto(req.user!));
});

apiRouter.patch('/me', requireAuth, async (req: Request, res: Response) => {
  const parsed = updateMeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({
      detail: parsed.error.issues.map((i) => i.message).join('; '),
    });
    return;
  }

  const currentUser = req.user!;
  const nextName = parsed.data.name ?? currentUser.name;
  const nextLang = parsed.data.language ?? currentUser.language;
  const nextOrgZone =
    parsed.data.organization ??
    parsed.data.organization_zone ??
    currentUser.organizationZone;

  const db = getDb();
  await db
    .update(users)
    .set({
      name: nextName,
      language: nextLang,
      organizationZone: nextOrgZone,
    })
    .where(eq(users.id, currentUser.id));

  const updated = {
    ...currentUser,
    name: nextName,
    language: nextLang,
    organization: nextOrgZone,
    organizationZone: nextOrgZone,
  };
  res.status(200).json(toUserResponseDto(updated));
});

apiRouter.get(
  '/me/export',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const exportData = await exportUserData(db, req.user!);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="saathi-data-export.json"'
      );
      res.status(200).json(exportData);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Failed to export user data' });
    }
  }
);

apiRouter.delete(
  '/me',
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = deleteAccountSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({
        detail: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }

    try {
      const db = getDb();
      const result = await deleteUserAccount(db, req.user!, {
        confirmation: parsed.data.confirmation,
        otp_code: parsed.data.otp_code,
        cancel_pin: parsed.data.cancel_pin,
      });

      clearAuthCookies(res);
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Failed to delete user account' });
    }
  }
);

apiRouter.get(
  '/rbac/admin-check',
  requireAuth,
  requireRole('admin'),
  (req: Request, res: Response) => {
    res.status(200).json({
      status: 'allowed',
      role: req.user!.role,
    });
  }
);

apiRouter.get(
  '/rbac/responder-check',
  requireAuth,
  requireRole('responder', 'admin'),
  (req: Request, res: Response) => {
    res.status(200).json({
      status: 'allowed',
      role: req.user!.role,
    });
  }
);
