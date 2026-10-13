import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getDb } from '../core/db';
import { requireAuth, requireRole } from '../core/middleware';
import { HttpError } from '../services/authService';
import { listIncidentAccessAudit } from '../services/auditService';
import {
  getResponderIncidentDetail,
  listAllRespondersForAdmin,
  listResponderIncidents,
  performResponderIncidentAction,
  updateResponderForAdmin,
} from '../services/responderService';

export const responderRouter = Router();

const responderActionSchema = z.object({
  note: z.string().trim().max(500).optional(),
  target_responder_user_id: z.string().trim().min(1).optional(),
});

const responderIdParamSchema = z.object({
  id: z.string().trim().min(1).max(128),
});

const auditLogQuerySchema = z.object({
  incident_id: z.string().trim().max(128).optional(),
  actor_type: z.string().trim().max(64).optional(),
});

const updateResponderAdminSchema = z
  .object({
    active: z.boolean().optional(),
    on_duty: z.boolean().optional(),
  })
  .strict()
  .refine(
    (data) => data.active !== undefined || data.on_duty !== undefined,
    {
      message: 'Only boolean fields "active" and "on_duty" are allowed.',
    }
  );

// GET /api/responder/incidents (role responder only; only incidents routed to this responder's organization; open first)
responderRouter.get(
  '/responder/incidents',
  requireAuth,
  requireRole('responder'),
  async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const result = await listResponderIncidents(db, req.user!.id);
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

// GET /api/responder/incidents/:id (role responder only; real status including is_duress; latest location only if user has location consent; events timeline; phone only after acknowledging)
responderRouter.get(
  '/responder/incidents/:id',
  requireAuth,
  requireRole('responder'),
  async (req: Request, res: Response) => {
    const paramParsed = responderIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      res.status(422).json({ detail: 'Invalid incident ID parameter' });
      return;
    }
    try {
      const db = getDb();
      const incident = await getResponderIncidentDetail(
        db,
        req.user!.id,
        paramParsed.data.id
      );
      res.status(200).json({ incident });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
);

const ACTION_ENDPOINTS = [
  'acknowledge',
  'assign',
  'note',
  'responding',
  'resolve',
  'false-alarm',
] as const;

for (const action of ACTION_ENDPOINTS) {
  responderRouter.post(
    `/responder/incidents/:id/${action}`,
    requireAuth,
    requireRole('responder'),
    async (req: Request, res: Response) => {
      const paramParsed = responderIdParamSchema.safeParse(req.params);
      if (!paramParsed.success) {
        res.status(422).json({ detail: 'Invalid incident ID parameter' });
        return;
      }
      const parsed = responderActionSchema.safeParse(req.body || {});
      if (!parsed.success) {
        res.status(422).json({
          detail: parsed.error.issues.map((i) => i.message).join('; '),
        });
        return;
      }

      try {
        const db = getDb();
        const incident = await performResponderIncidentAction(
          db,
          req.user!.id,
          paramParsed.data.id,
          action,
          parsed.data
        );
        res.status(200).json({ incident });
      } catch (err) {
        if (err instanceof HttpError) {
          res.status(err.status).json({ detail: err.message });
          return;
        }
        res.status(500).json({ detail: 'Internal server error' });
      }
    }
  );
}

// GET /api/admin/audit-log and /api/admin/audit-logs (admin-only read endpoint for incident access audit log)
responderRouter.get(
  ['/admin/audit-log', '/admin/audit-logs'],
  requireAuth,
  requireRole('admin'),
  async (req: Request, res: Response) => {
    const queryParsed = auditLogQuerySchema.safeParse(req.query);
    if (!queryParsed.success) {
      res.status(422).json({ detail: 'Invalid audit log query parameters' });
      return;
    }
    try {
      const db = getDb();
      const incidentId = queryParsed.data.incident_id || undefined;
      const actorType =
        queryParsed.data.actor_type &&
        ['contact', 'responder', 'admin'].includes(queryParsed.data.actor_type)
          ? (queryParsed.data.actor_type as 'contact' | 'responder' | 'admin')
          : undefined;
      const entries = await listIncidentAccessAudit(db, incidentId, actorType);
      res.status(200).json({ entries });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
);

// GET /api/admin/responders (admin only: id, name, organization_zone, active, on_duty; no phone or incident data)
responderRouter.get(
  '/admin/responders',
  requireAuth,
  requireRole('admin'),
  async (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const respondersList = await listAllRespondersForAdmin(db);
      res.status(200).json({ responders: respondersList });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Internal server error' });
    }
  }
);

// PATCH /api/admin/responders/:id (admin only: strict { active?: boolean, on_duty?: boolean }, rejects anything else with 400)
responderRouter.patch(
  '/admin/responders/:id',
  requireAuth,
  requireRole('admin'),
  async (req: Request, res: Response) => {
    const paramParsed = responderIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      res.status(400).json({ detail: 'Invalid responder ID parameter.' });
      return;
    }
    const bodyParsed = updateResponderAdminSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      res.status(400).json({
        detail:
          'Only boolean fields "active" and "on_duty" are allowed.',
      });
      return;
    }

    try {
      const db = getDb();
      const result = await updateResponderForAdmin(
        db,
        { id: req.user!.id, name: req.user!.name },
        paramParsed.data.id,
        {
          active: bodyParsed.data.active,
          on_duty: bodyParsed.data.on_duty,
        }
      );
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

