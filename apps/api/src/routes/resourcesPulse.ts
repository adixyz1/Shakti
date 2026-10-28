import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getDb } from '../core/db';
import { optionalAuth, requireAuth, requireRole } from '../core/middleware';
import { HttpError } from '../services/authService';
import {
  createResourceForAdmin,
  deleteResourceForAdmin,
  getPulseStatusForUser,
  listResources,
  submitSafetyPulse,
  updateResourceForAdmin,
} from '../services/resourcePulseService';

export const resourcesPulseRouter = Router();

const createResourceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(600),
  available_hours: z.string().trim().min(1).max(120),
  active: z.boolean().optional().default(true),
});

const updateResourceSchema = createResourceSchema.partial();

const submitPulseSchema = z.object({
  safety_score: z.number().int().min(1).max(5),
  avoided_going_somewhere: z.boolean(),
  anonymous: z.boolean().optional().default(false),
});

const resourcesQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  category: z.string().trim().max(100).optional(),
});

const resourceIdParamSchema = z.object({
  id: z.string().trim().min(1).max(128),
});

// GET /api/resources (search by text `q` and `category`)
resourcesPulseRouter.get(
  '/resources',
  async (req: Request, res: Response) => {
    const queryParsed = resourcesQuerySchema.safeParse(req.query);
    if (!queryParsed.success) {
      res.status(422).json({ detail: 'Invalid resources query parameters' });
      return;
    }
    try {
      const db = getDb();
      const q = queryParsed.data.q || undefined;
      const category = queryParsed.data.category || undefined;
      const items = await listResources(db, { q, category });
      res.status(200).json({ resources: items });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
);

// Admin create/update/delete resources (mounted on both /api/admin/resources and /api/resources for admin convenience)
resourcesPulseRouter.post(
  ['/admin/resources', '/resources'],
  requireAuth,
  requireRole('admin'),
  async (req: Request, res: Response) => {
    const parsed = createResourceSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(422).json({
        detail: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }

    try {
      const db = getDb();
      const resource = await createResourceForAdmin(db, parsed.data);
      res.status(201).json({ resource });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
);

resourcesPulseRouter.put(
  ['/admin/resources/:id', '/resources/:id'],
  requireAuth,
  requireRole('admin'),
  async (req: Request, res: Response) => {
    const paramParsed = resourceIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      res.status(422).json({ detail: 'Invalid resource ID parameter' });
      return;
    }
    const parsed = updateResourceSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(422).json({
        detail: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }

    try {
      const db = getDb();
      const resource = await updateResourceForAdmin(
        db,
        paramParsed.data.id,
        parsed.data
      );
      res.status(200).json({ resource });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
);

resourcesPulseRouter.delete(
  ['/admin/resources/:id', '/resources/:id'],
  requireAuth,
  requireRole('admin'),
  async (req: Request, res: Response) => {
    const paramParsed = resourceIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      res.status(422).json({ detail: 'Invalid resource ID parameter' });
      return;
    }
    try {
      const db = getDb();
      const deleted = await deleteResourceForAdmin(db, paramParsed.data.id);
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

// GET /api/pulse/status (guest or authenticated; prompt appears at most once a week)
resourcesPulseRouter.get(
  '/pulse/status',
  optionalAuth,
  async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const forwardedIp =
        typeof req.headers['x-forwarded-for'] === 'string'
          ? req.headers['x-forwarded-for'].split(',')[0].trim()
          : req.ip;
      const guestKey = `anon_ip:${forwardedIp || 'unknown'}`;
      const status = await getPulseStatusForUser(
        db,
        req.user?.id,
        Date.now(),
        guestKey
      );
      res.status(200).json(status);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
);

// POST /api/pulse (guest or authenticated; optional anonymous; two questions only)
resourcesPulseRouter.post(
  '/pulse',
  optionalAuth,
  async (req: Request, res: Response) => {
    const parsed = submitPulseSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(422).json({
        detail: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }

    try {
      const db = getDb();
      const forwardedIp =
        typeof req.headers['x-forwarded-for'] === 'string'
          ? req.headers['x-forwarded-for'].split(',')[0].trim()
          : req.ip;
      const guestKey = `anon_ip:${forwardedIp || 'unknown'}`;
      const pulse = await submitSafetyPulse(
        db,
        req.user?.id,
        parsed.data,
        Date.now(),
        guestKey
      );
      res.status(201).json({ pulse });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
);
