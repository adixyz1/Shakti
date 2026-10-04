import { Router, type Request, type Response } from 'express';
import { getDb } from '../core/db';
import { requireAuth } from '../core/middleware';
import { postConsentSchema } from '../schemas/consent';
import {
  appendConsentEntry,
  getConsentsForUser,
} from '../services/consentService';

export const consentsRouter = Router();

consentsRouter.get('/consents', requireAuth, async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const overview = await getConsentsForUser(db, req.user!.id);
    res.status(200).json(overview);
  } catch {
    res.status(500).json({ detail: 'Failed to load consent ledger' });
  }
});

consentsRouter.post('/consents', requireAuth, async (req: Request, res: Response) => {
  const parsed = postConsentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({
      detail: parsed.error.issues.map((i) => i.message).join('; '),
    });
    return;
  }

  try {
    const db = getDb();
    const result = await appendConsentEntry(db, {
      userId: req.user!.id,
      type: parsed.data.type,
      granted: parsed.data.granted,
      source: parsed.data.source,
    });
    res.status(201).json(result);
  } catch {
    res.status(500).json({ detail: 'Failed to append consent ledger entry' });
  }
});
