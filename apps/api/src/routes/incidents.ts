import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getDb } from '../core/db';
import {
  pinSettingsRateLimitMiddleware,
  requireAuth,
} from '../core/middleware';
import {
  cancelIncidentSchema,
  createIncidentSchema,
  locationSampleInputSchema,
  resolveIncidentSchema,
  setEmergencyTypeSchema,
  submitIncidentRatingSchema,
  updateCancelPinSchema,
  updateCancelWindowSchema,
  updateDuressPinSchema,
} from '../schemas/incident';
import { HttpError } from '../services/authService';
import { getNotifiableContacts } from '../services/contactService';
import {
  addIncidentLocationSample,
  cancelIncidentForUser,
  createOrMergeIncident,
  getActiveIncidentForUser,
  getHydratedIncident,
  resolveIncidentForUser,
  setIncidentEmergencyType,
  submitPostIncidentRating,
  updateUserCancelPin,
  updateUserCancelWindow,
  updateUserDuressPin,
} from '../services/incidentService';

export const incidentsRouter = Router();

incidentsRouter.post(
  '/incidents',
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = createIncidentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        detail: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }

    try {
      const db = getDb();
      const result = await createOrMergeIncident(db, req.user!, parsed.data);
      const statusCode =
        result.idempotent_replay || result.merged_into_existing ? 200 : 201;
      res.status(statusCode).json(result);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Failed to create incident' });
    }
  }
);

incidentsRouter.get(
  '/incidents/active',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const active = await getActiveIncidentForUser(db, req.user!.id);
      const notifiableContacts = await getNotifiableContacts(
        req.user!.id,
        'sos',
        db
      );
      res.status(200).json({
        incident: active,
        notifiable_contacts_count: notifiableContacts.length,
      });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Failed to fetch active incident' });
    }
  }
);

const incidentIdParamSchema = z.object({
  id: z.string().trim().min(1).max(128),
});

incidentsRouter.get(
  '/incidents/:id',
  requireAuth,
  async (req: Request, res: Response) => {
    const paramParsed = incidentIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      res.status(422).json({ detail: 'Invalid incident ID parameter' });
      return;
    }
    try {
      const db = getDb();
      const isResponderOrAdmin =
        req.user!.role === 'responder' || req.user!.role === 'admin';
      const incident = await getHydratedIncident(
        db,
        paramParsed.data.id,
        isResponderOrAdmin ? undefined : req.user!.id,
        { viewerRole: isResponderOrAdmin ? 'responder' : 'owner' }
      );
      res.status(200).json({
        incident,
        notifiable_contacts_count: incident.notifiable_contacts_count ?? 0,
      });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Failed to fetch incident' });
    }
  }
);

incidentsRouter.post(
  '/incidents/:id/cancel',
  requireAuth,
  async (req: Request, res: Response) => {
    const paramParsed = incidentIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      res.status(422).json({ detail: 'Invalid incident ID parameter' });
      return;
    }
    const parsed = cancelIncidentSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(422).json({
        detail: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }

    try {
      const db = getDb();
      const result = await cancelIncidentForUser(
        db,
        req.user!,
        paramParsed.data.id,
        parsed.data
      );
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Failed to cancel incident' });
    }
  }
);

incidentsRouter.post(
  '/incidents/:id/location',
  requireAuth,
  async (req: Request, res: Response) => {
    const paramParsed = incidentIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      res.status(422).json({ detail: 'Invalid incident ID parameter' });
      return;
    }
    const parsed = locationSampleInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        detail: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }

    try {
      const db = getDb();
      const location = await addIncidentLocationSample(
        db,
        req.user!,
        paramParsed.data.id,
        parsed.data
      );
      res.status(201).json({ location });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Failed to store location sample' });
    }
  }
);

incidentsRouter.post(
  '/incidents/:id/type',
  requireAuth,
  async (req: Request, res: Response) => {
    const paramParsed = incidentIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      res.status(422).json({ detail: 'Invalid incident ID parameter' });
      return;
    }
    const parsed = setEmergencyTypeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        detail: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }

    try {
      const db = getDb();
      const incident = await setIncidentEmergencyType(
        db,
        req.user!,
        paramParsed.data.id,
        parsed.data.emergency_type
      );
      res.status(200).json({ incident });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Failed to set emergency type' });
    }
  }
);

incidentsRouter.post(
  '/incidents/:id/resolve',
  requireAuth,
  async (req: Request, res: Response) => {
    const paramParsed = incidentIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      res.status(422).json({ detail: 'Invalid incident ID parameter' });
      return;
    }
    const parsed = resolveIncidentSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(422).json({
        detail: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }

    try {
      const db = getDb();
      const incident = await resolveIncidentForUser(
        db,
        req.user!,
        paramParsed.data.id,
        parsed.data
      );
      res.status(200).json({ incident });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Failed to resolve incident' });
    }
  }
);

incidentsRouter.post(
  '/incidents/:id/rating',
  requireAuth,
  async (req: Request, res: Response) => {
    const paramParsed = incidentIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      res.status(422).json({ detail: 'Invalid incident ID parameter' });
      return;
    }
    const parsed = submitIncidentRatingSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(422).json({
        detail: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }

    try {
      const db = getDb();
      const rating = await submitPostIncidentRating(
        db,
        req.user!,
        paramParsed.data.id,
        parsed.data.score
      );
      res.status(201).json({ rating });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Failed to submit post-incident rating' });
    }
  }
);

incidentsRouter.put(
  '/settings/cancel-window',
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = updateCancelWindowSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        detail: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }

    try {
      const db = getDb();
      const result = await updateUserCancelWindow(
        db,
        req.user!.id,
        parsed.data.cancel_window_seconds
      );
      res.status(200).json(result);
    } catch {
      res.status(500).json({ detail: 'Failed to update cancel window' });
    }
  }
);

incidentsRouter.put(
  '/settings/cancel-pin',
  requireAuth,
  pinSettingsRateLimitMiddleware,
  async (req: Request, res: Response) => {
    const parsed = updateCancelPinSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        detail: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }

    try {
      const db = getDb();
      const result = await updateUserCancelPin(
        db,
        req.user!.id,
        parsed.data.pin
      );
      res.status(200).json(result);
    } catch {
      res.status(500).json({ detail: 'Failed to update cancel PIN' });
    }
  }
);

incidentsRouter.put(
  '/settings/duress-pin',
  requireAuth,
  pinSettingsRateLimitMiddleware,
  async (req: Request, res: Response) => {
    const parsed = updateDuressPinSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        detail: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }

    try {
      const db = getDb();
      const result = await updateUserDuressPin(
        db,
        req.user!.id,
        parsed.data.pin,
        parsed.data.cancel_pin
      );
      res.status(200).json(result);
    } catch {
      res.status(500).json({ detail: 'Failed to update duress PIN' });
    }
  }
);
