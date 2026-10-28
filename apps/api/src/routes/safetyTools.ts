import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getDb } from '../core/db';
import {
  requireAuth,
  requireRole,
  safetyToolsRateLimitMiddleware,
} from '../core/middleware';
import { HttpError } from '../services/authService';
import {
  createSafetyToolForAdmin,
  deleteSafetyToolForAdmin,
  listSafetyTools,
  updateSafetyToolForAdmin,
} from '../services/safetyToolsService';

export const safetyToolsRouter = Router();

const toolsQuerySchema = z.object({
  category: z.string().trim().max(100).optional(),
});

const toolIdParamSchema = z.object({
  id: z.string().trim().min(1).max(128),
});

const httpsUrlSchema = z
  .string()
  .trim()
  .url({ message: 'Must be a valid URL' })
  .refine((val) => val.startsWith('https://'), {
    message: 'Link URL must use HTTPS protocol',
  });

const createSafetyToolSchema = z.object({
  category: z.string().trim().min(1, 'Category is required').max(100),
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().trim().min(1, 'Description is required').max(2000),
  safe_use_notes: z.string().trim().min(1, 'Safe use notes are required').max(2000),
  legal_note: z.string().trim().min(1, 'Legal note is required').max(2000),
  link_url: z
    .union([httpsUrlSchema, z.literal('').transform(() => null), z.null()])
    .optional(),
  link_label: z.string().trim().max(100).optional(),
  last_checked: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Last checked date must be in YYYY-MM-DD format')
    .optional(),
  active: z.boolean().optional(),
  is_affiliate: z.boolean().optional(),
});

const updateSafetyToolSchema = z.object({
  category: z.string().trim().min(1).max(100).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(2000).optional(),
  safe_use_notes: z.string().trim().min(1).max(2000).optional(),
  legal_note: z.string().trim().min(1).max(2000).optional(),
  link_url: z
    .union([httpsUrlSchema, z.literal('').transform(() => null), z.null()])
    .optional(),
  link_label: z.string().trim().max(100).optional(),
  last_checked: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Last checked date must be in YYYY-MM-DD format')
    .optional(),
  active: z.boolean().optional(),
  is_affiliate: z.boolean().optional(),
});

// GET /api/safety-tools (public, guest-allowed, rate-limited)
safetyToolsRouter.get(
  '/safety-tools',
  safetyToolsRateLimitMiddleware,
  async (req: Request, res: Response) => {
    const queryParsed = toolsQuerySchema.safeParse(req.query);
    if (!queryParsed.success) {
      res.status(422).json({ detail: 'Invalid safety tools query parameters' });
      return;
    }

    try {
      const db = getDb();
      const category = queryParsed.data.category || undefined;
      const includeInactive = req.user?.role === 'admin' && req.query.include_inactive === 'true';
      const items = await listSafetyTools(db, { category, includeInactive });
      res.status(200).json({ safety_tools: items });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
);

// Admin create safety tools
safetyToolsRouter.post(
  ['/admin/safety-tools', '/safety-tools'],
  requireAuth,
  requireRole('admin'),
  async (req: Request, res: Response) => {
    const parsed = createSafetyToolSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(422).json({
        detail: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }

    try {
      const db = getDb();
      const tool = await createSafetyToolForAdmin(db, parsed.data);
      res.status(201).json({ safety_tool: tool });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
);

// Admin update safety tools
safetyToolsRouter.put(
  ['/admin/safety-tools/:id', '/safety-tools/:id'],
  requireAuth,
  requireRole('admin'),
  async (req: Request, res: Response) => {
    const paramParsed = toolIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      res.status(422).json({ detail: 'Invalid tool ID parameter' });
      return;
    }

    const parsed = updateSafetyToolSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(422).json({
        detail: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }

    try {
      const db = getDb();
      const tool = await updateSafetyToolForAdmin(
        db,
        paramParsed.data.id,
        parsed.data
      );
      res.status(200).json({ safety_tool: tool });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
);

// Admin delete safety tools
safetyToolsRouter.delete(
  ['/admin/safety-tools/:id', '/safety-tools/:id'],
  requireAuth,
  requireRole('admin'),
  async (req: Request, res: Response) => {
    const paramParsed = toolIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      res.status(422).json({ detail: 'Invalid tool ID parameter' });
      return;
    }

    try {
      const db = getDb();
      const result = await deleteSafetyToolForAdmin(db, paramParsed.data.id);
      res.status(200).json({ success: true, deleted_id: result.deleted_id });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
);
