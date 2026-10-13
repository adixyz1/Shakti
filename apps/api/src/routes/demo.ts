import { Router, type NextFunction, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { isDemoModeEnabled } from '../core/config';
import { getDb } from '../core/db';
import { requireAuth, requireRole, resetRateLimiter } from '../core/middleware';
import { locationSamples } from '../db/schema';
import { defaultPushProvider } from '../providers/push';
import { defaultSmsProvider } from '../providers/sms';
import { HttpError } from '../services/authService';
import {
  getDemoStatusDto,
  resetAndSeedDemoData,
  simulateContactStep,
  simulateResponderStep,
} from '../services/demoService';
import { runLocationRetentionPurge } from '../services/retentionService';

export const demoRouter = Router();

function requireTestEnvOnly(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (process.env.NODE_ENV !== 'test') {
    res.status(404).json({ detail: 'Not found' });
    return;
  }
  next();
}

function requireDemoModeEnabled(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!isDemoModeEnabled()) {
    res.status(404).json({ detail: 'Not found' });
    return;
  }
  next();
}

const simulateResponderSchema = z.object({
  incident_id: z.string().trim().min(1).optional(),
  action: z.enum(['acknowledge', 'responding', 'resolve']),
  delay_ms: z.number().int().min(0).max(2000).optional(),
  note: z.string().trim().max(500).optional(),
});

const simulateContactSchema = z.object({
  incident_id: z.string().trim().min(1).optional(),
  action: z.enum(['seen', 'on_my_way']),
  contact_id: z.string().trim().min(1).optional(),
  delay_ms: z.number().int().min(0).max(2000).optional(),
  note: z.string().trim().max(500).optional(),
});

// GET /api/demo/status (404 when DEMO_MODE is off)
demoRouter.get(
  '/demo/status',
  requireDemoModeEnabled,
  (_req: Request, res: Response) => {
    res.status(200).json(getDemoStatusDto());
  }
);

// POST /api/demo/reset (404 when DEMO_MODE is off; admin only; idempotent)
demoRouter.post(
  '/demo/reset',
  requireDemoModeEnabled,
  requireAuth,
  requireRole('admin'),
  async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const result = await resetAndSeedDemoData(db, {
        actorAdmin: { id: req.user!.id, name: req.user!.name },
      });
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Failed to reset demo data' });
    }
  }
);

// POST /api/demo/simulate/responder (404 when DEMO_MODE is off; admin or demo user)
demoRouter.post(
  '/demo/simulate/responder',
  requireDemoModeEnabled,
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = simulateResponderSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(422).json({
        detail: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }

    try {
      const db = getDb();
      const result = await simulateResponderStep(db, req.user!, parsed.data);
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Failed to simulate responder action' });
    }
  }
);

// POST /api/demo/simulate/contact (404 when DEMO_MODE is off; admin or demo user)
demoRouter.post(
  '/demo/simulate/contact',
  requireDemoModeEnabled,
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = simulateContactSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(422).json({
        detail: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }

    try {
      const db = getDb();
      const result = await simulateContactStep(db, req.user!, parsed.data);
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Failed to simulate contact response' });
    }
  }
);

// TEST-ONLY HOOKS (Strictly 404 unless NODE_ENV=test)
demoRouter.post(
  '/test/retention/purge',
  requireTestEnvOnly,
  async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const expireIncidentId =
        typeof req.body?.expire_incident_id === 'string'
          ? req.body.expire_incident_id.trim()
          : '';
      if (expireIncidentId) {
        await db
          .update(locationSamples)
          .set({ expiresAt: Date.now() - 10_000 })
          .where(eq(locationSamples.incidentId, expireIncidentId));
      }
      const nowMs =
        typeof req.body?.now_ms === 'number' ? req.body.now_ms : Date.now();
      const summary = await runLocationRetentionPurge(db, nowMs);
      const remainingForIncident = expireIncidentId
        ? await db
            .select({ id: locationSamples.id })
            .from(locationSamples)
            .where(eq(locationSamples.incidentId, expireIncidentId))
        : [];
      res.status(200).json({
        summary,
        remaining_for_incident: remainingForIncident.length,
      });
    } catch (err) {
      res.status(500).json({
        detail:
          err instanceof Error ? err.message : 'Retention purge hook failed',
      });
    }
  }
);

demoRouter.post(
  '/test/providers/failure',
  requireTestEnvOnly,
  (req: Request, res: Response) => {
    const failPush = Boolean(req.body?.fail_push);
    const failSms = Boolean(req.body?.fail_sms);
    defaultPushProvider.setSimulateFailure(
      failPush,
      'Simulated E2E PushProvider failure'
    );
    defaultSmsProvider.setSimulateFailure(
      failSms,
      'Simulated E2E SmsProvider failure'
    );
    res.status(200).json({
      fail_push: failPush,
      fail_sms: failSms,
      ai_assist_enabled: false,
    });
  }
);

demoRouter.post(
  '/test/ratelimit/reset',
  requireTestEnvOnly,
  (_req: Request, res: Response) => {
    resetRateLimiter();
    res.status(200).json({ status: 'reset' });
  }
);
