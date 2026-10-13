import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getDb } from '../core/db';
import { requireAuth, requireRole } from '../core/middleware';
import { HttpError } from '../services/authService';
import {
  computeImpactMetrics,
  formatImpactMetricsCsv,
} from '../services/metricsService';

export const metricsRouter = Router();

const metricsQuerySchema = z.object({
  from: z.string().trim().max(64).optional(),
  to: z.string().trim().max(64).optional(),
});

metricsRouter.get(
  '/admin/metrics',
  requireAuth,
  requireRole('admin'),
  async (req: Request, res: Response) => {
    const queryParsed = metricsQuerySchema.safeParse(req.query);
    if (!queryParsed.success) {
      res.status(422).json({ detail: 'Invalid metrics query parameters' });
      return;
    }
    try {
      const db = getDb();
      const from = queryParsed.data.from || undefined;
      const to = queryParsed.data.to || undefined;
      const result = await computeImpactMetrics(db, { from, to });
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Failed to compute impact metrics' });
    }
  }
);

metricsRouter.get(
  '/admin/metrics.csv',
  requireAuth,
  requireRole('admin'),
  async (req: Request, res: Response) => {
    const queryParsed = metricsQuerySchema.safeParse(req.query);
    if (!queryParsed.success) {
      res.status(422).json({ detail: 'Invalid metrics query parameters' });
      return;
    }
    try {
      const db = getDb();
      const from = queryParsed.data.from || undefined;
      const to = queryParsed.data.to || undefined;
      const result = await computeImpactMetrics(db, { from, to });
      const csv = formatImpactMetricsCsv(result);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="saathi-impact-metrics.csv"'
      );
      res.status(200).send(csv);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Failed to export impact metrics CSV' });
    }
  }
);
