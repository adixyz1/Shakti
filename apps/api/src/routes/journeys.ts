import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getDb } from '../core/db';
import { requireAuth } from '../core/middleware';
import { HttpError } from '../services/authService';
import {
  cancelJourneyForUser,
  completeJourneyForUser,
  extendJourneyForUser,
  getActiveJourneyForUser,
  getJourneyByIdForUser,
  startJourneyForUser,
} from '../services/journeyService';

export const journeysRouter = Router();

const startJourneySchema = z
  .object({
    duration_minutes: z.number().int().min(1).max(240).optional(),
    duration_seconds: z.number().positive().max(240 * 60).optional(),
    contact_id: z.string().trim().min(1).nullable().optional(),
    note: z.string().trim().max(100).nullable().optional(),
    reminder_lead_ms: z.number().nonnegative().optional(),
  })
  .refine(
    (data) =>
      data.duration_minutes !== undefined ||
      data.duration_seconds !== undefined,
    {
      message: 'duration_minutes is required.',
    }
  );

const extendJourneySchema = z.object({
  additional_minutes: z.number().int().min(1).max(180).optional(),
  duration_minutes: z.number().int().min(1).max(180).optional(),
});

const journeyIdParamSchema = z.object({
  id: z.string().trim().min(1).max(128),
});

// GET /api/journeys/active (owner only)
journeysRouter.get(
  '/journeys/active',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const journey = await getActiveJourneyForUser(db, req.user!.id);
      res.status(200).json({ journey });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
);

// POST /api/journeys (alias /api/journeys/start) - start journey (owner only)
journeysRouter.post(
  ['/journeys', '/journeys/start'],
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = startJourneySchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(422).json({
        detail: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }

    try {
      const db = getDb();
      const journey = await startJourneyForUser(
        db,
        req.user!.id,
        {
          duration_minutes: parsed.data.duration_minutes,
          duration_seconds: parsed.data.duration_seconds,
          contact_id: parsed.data.contact_id ?? null,
          note: parsed.data.note ?? null,
        },
        parsed.data.reminder_lead_ms !== undefined
          ? { reminderLeadMs: parsed.data.reminder_lead_ms }
          : undefined
      );
      res.status(201).json({ journey });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
);

// GET /api/journeys/:id (owner only)
journeysRouter.get(
  '/journeys/:id',
  requireAuth,
  async (req: Request, res: Response) => {
    const paramParsed = journeyIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      res.status(422).json({ detail: 'Invalid journey ID parameter' });
      return;
    }
    try {
      const db = getDb();
      const journey = await getJourneyByIdForUser(
        db,
        req.user!.id,
        paramParsed.data.id
      );
      res.status(200).json({ journey });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
);

// POST /api/journeys/:id/extend (owner only)
journeysRouter.post(
  '/journeys/:id/extend',
  requireAuth,
  async (req: Request, res: Response) => {
    const paramParsed = journeyIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      res.status(422).json({ detail: 'Invalid journey ID parameter' });
      return;
    }
    const parsed = extendJourneySchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(422).json({
        detail: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }

    const addMinutes =
      parsed.data.additional_minutes ?? parsed.data.duration_minutes ?? 10;

    try {
      const db = getDb();
      const journey = await extendJourneyForUser(
        db,
        req.user!.id,
        paramParsed.data.id,
        addMinutes
      );
      res.status(200).json({ journey });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
);

// POST /api/journeys/:id/complete ("I'm safe", owner only)
journeysRouter.post(
  '/journeys/:id/complete',
  requireAuth,
  async (req: Request, res: Response) => {
    const paramParsed = journeyIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      res.status(422).json({ detail: 'Invalid journey ID parameter' });
      return;
    }
    try {
      const db = getDb();
      const journey = await completeJourneyForUser(
        db,
        req.user!.id,
        paramParsed.data.id
      );
      res.status(200).json({ journey });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
);

// POST /api/journeys/:id/cancel (owner only)
journeysRouter.post(
  '/journeys/:id/cancel',
  requireAuth,
  async (req: Request, res: Response) => {
    const paramParsed = journeyIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      res.status(422).json({ detail: 'Invalid journey ID parameter' });
      return;
    }
    try {
      const db = getDb();
      const journey = await cancelJourneyForUser(
        db,
        req.user!.id,
        paramParsed.data.id
      );
      res.status(200).json({ journey });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
);
