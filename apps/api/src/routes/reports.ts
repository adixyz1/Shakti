import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getDb } from '../core/db';
import {
  checkAndRecordReportDailyCap,
  reportRateLimitMiddleware,
  requireAuth,
  requireRole,
} from '../core/middleware';
import { REPORT_CATEGORIES } from '../db/schema';
import { HttpError } from '../services/authService';
import {
  createSafetyReport,
  deleteReportForAdmin,
  getAggregatedSafetyLayer,
  listRawReportsForAdmin,
} from '../services/reportService';

export const reportsRouter = Router();

const createReportSchema = z.object({
  category: z.enum(REPORT_CATEGORIES),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  note: z.string().trim().max(500).nullable().optional(),
  anonymous: z.boolean().optional().default(true),
});

// POST /api/reports (authenticated users; rate-limited; anonymous reports store NO user_id and logs do not link them)
reportsRouter.post(
  '/reports',
  requireAuth,
  reportRateLimitMiddleware,
  async (req: Request, res: Response) => {
    const parsed = createReportSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(422).json({
        detail: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }

    const isAnon = parsed.data.anonymous !== false;
    const forwardedIp =
      typeof req.headers['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for'].split(',')[0].trim()
        : req.ip;

    if (!checkAndRecordReportDailyCap(isAnon, req.user?.id, forwardedIp)) {
      res.status(429).json({
        detail:
          'Daily safety report limit reached (5 reports per day). Please try again tomorrow.',
      });
      return;
    }

    try {
      const db = getDb();
      // If anonymous is true, do not pass req.user.id into the service at all
      const effectiveUserId = isAnon ? null : req.user!.id;
      const report = await createSafetyReport(db, effectiveUserId, parsed.data);
      res.status(201).json({ report });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
);

// GET /api/reports -> Forbidden for normal users (raw reports are never readable by normal users)
reportsRouter.get(
  '/reports',
  requireAuth,
  (_req: Request, res: Response) => {
    res.status(403).json({
      detail:
        'Raw safety reports cannot be read by users. Use GET /api/safety-layer for the k-anonymized aggregated layer.',
    });
  }
);

const safetyLayerQuerySchema = z.object({
  k: z
    .string()
    .trim()
    .regex(/^\d+$/)
    .optional(),
});

const reportIdParamSchema = z.object({
  id: z.string().trim().min(1).max(128),
});

// GET /api/safety-layer -> Aggregated counts per ~100m grid cell (3 decimals) with >= K reports
reportsRouter.get(
  '/safety-layer',
  requireAuth,
  async (req: Request, res: Response) => {
    const queryParsed = safetyLayerQuerySchema.safeParse(req.query);
    if (!queryParsed.success) {
      res.status(422).json({ detail: 'Invalid safety-layer query parameters' });
      return;
    }
    try {
      const db = getDb();
      const rawK = queryParsed.data.k ? Number(queryParsed.data.k) : undefined;
      const overrideK =
        rawK !== undefined && Number.isFinite(rawK) && rawK >= 1
          ? Math.floor(rawK)
          : undefined;

      const result = await getAggregatedSafetyLayer(db, overrideK);
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

// GET /api/admin/reports -> Admin-only moderation endpoint to read raw reports
reportsRouter.get(
  '/admin/reports',
  requireAuth,
  requireRole('admin'),
  async (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const reportsList = await listRawReportsForAdmin(db);
      res.status(200).json({ reports: reportsList });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
);

// DELETE /api/admin/reports/:id -> Admin-only moderation endpoint to delete a report
reportsRouter.delete(
  '/admin/reports/:id',
  requireAuth,
  requireRole('admin'),
  async (req: Request, res: Response) => {
    const paramParsed = reportIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      res.status(422).json({ detail: 'Invalid report ID parameter' });
      return;
    }
    try {
      const db = getDb();
      const deleted = await deleteReportForAdmin(db, paramParsed.data.id);
      res.status(200).json(deleted);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
);
