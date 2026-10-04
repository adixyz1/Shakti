import { Router, type Request, type Response } from 'express';
import { desc } from 'drizzle-orm';
import { config } from '../core/config';
import { getDb } from '../core/db';
import { requireAuth } from '../core/middleware';
import { sentMessages } from '../db/schema';
import {
  createContactSchema,
  reorderContactsSchema,
  updateContactSchema,
} from '../schemas/contact';
import { HttpError } from '../services/authService';
import {
  acceptInvitationByToken,
  createContactForUser,
  declineInvitationByToken,
  getInvitationDetailsByToken,
  getNotifiableContacts,
  listContactsForUser,
  pauseContactForUser,
  removeContactForUser,
  reorderContactsForUser,
  resumeContactForUser,
  updateContactForUser,
} from '../services/contactService';

export const contactsRouter = Router();

contactsRouter.get('/contacts', requireAuth, async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const contacts = await listContactsForUser(db, req.user!.id);
    const notifiable = await getNotifiableContacts(req.user!.id, 'sos', db);
    res.status(200).json({
      contacts,
      notifiable_contacts_count: notifiable.length,
    });
  } catch {
    res.status(500).json({ detail: 'Failed to list trusted contacts' });
  }
});

contactsRouter.post('/contacts', requireAuth, async (req: Request, res: Response) => {
  const parsed = createContactSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({
      detail: parsed.error.issues.map((i) => i.message).join('; '),
    });
    return;
  }

  try {
    const db = getDb();
    const created = await createContactForUser(db, req.user!, parsed.data);
    const notifiable = await getNotifiableContacts(req.user!.id, 'sos', db);
    res.status(201).json({
      ...created,
      notifiable_contacts_count: notifiable.length,
    });
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ detail: err.message });
      return;
    }
    res.status(500).json({ detail: 'Failed to create trusted contact' });
  }
});

contactsRouter.post(
  '/contacts/reorder',
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = reorderContactsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        detail: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }

    try {
      const db = getDb();
      const contacts = await reorderContactsForUser(
        db,
        req.user!.id,
        parsed.data.ordered_ids
      );
      const notifiable = await getNotifiableContacts(req.user!.id, 'sos', db);
      res.status(200).json({
        contacts,
        notifiable_contacts_count: notifiable.length,
      });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Failed to reorder trusted contacts' });
    }
  }
);

contactsRouter.patch(
  '/contacts/:id',
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = updateContactSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        detail: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }

    try {
      const db = getDb();
      const contact = await updateContactForUser(
        db,
        req.user!.id,
        String(req.params.id),
        parsed.data
      );
      const notifiable = await getNotifiableContacts(req.user!.id, 'sos', db);
      res.status(200).json({
        contact,
        notifiable_contacts_count: notifiable.length,
      });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Failed to update trusted contact' });
    }
  }
);

contactsRouter.post(
  '/contacts/:id/pause',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const contact = await pauseContactForUser(
        db,
        req.user!.id,
        String(req.params.id)
      );
      const notifiable = await getNotifiableContacts(req.user!.id, 'sos', db);
      res.status(200).json({
        contact,
        notifiable_contacts_count: notifiable.length,
      });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Failed to pause trusted contact' });
    }
  }
);

contactsRouter.post(
  '/contacts/:id/resume',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const contact = await resumeContactForUser(
        db,
        req.user!.id,
        String(req.params.id)
      );
      const notifiable = await getNotifiableContacts(req.user!.id, 'sos', db);
      res.status(200).json({
        contact,
        notifiable_contacts_count: notifiable.length,
      });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Failed to resume trusted contact' });
    }
  }
);

contactsRouter.delete(
  '/contacts/:id',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const result = await removeContactForUser(
        db,
        req.user!.id,
        String(req.params.id)
      );
      const notifiable = await getNotifiableContacts(req.user!.id, 'sos', db);
      res.status(200).json({
        ...result,
        notifiable_contacts_count: notifiable.length,
      });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Failed to remove trusted contact' });
    }
  }
);

contactsRouter.post(
  '/contacts/:id/remove',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const result = await removeContactForUser(
        db,
        req.user!.id,
        String(req.params.id)
      );
      const notifiable = await getNotifiableContacts(req.user!.id, 'sos', db);
      res.status(200).json({
        ...result,
        notifiable_contacts_count: notifiable.length,
      });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Failed to remove trusted contact' });
    }
  }
);

// Public invitation endpoints (no login required)
contactsRouter.get('/invitations/:token', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const details = await getInvitationDetailsByToken(
      db,
      String(req.params.token)
    );
    res.status(200).json(details);
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ detail: err.message });
      return;
    }
    res.status(500).json({ detail: 'Failed to inspect invitation' });
  }
});

contactsRouter.post(
  '/invitations/:token/accept',
  async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const result = await acceptInvitationByToken(
        db,
        String(req.params.token)
      );
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Failed to accept invitation' });
    }
  }
);

contactsRouter.post(
  '/invitations/:token/decline',
  async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const result = await declineInvitationByToken(
        db,
        String(req.params.token)
      );
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ detail: err.message });
        return;
      }
      res.status(500).json({ detail: 'Failed to decline invitation' });
    }
  }
);

// Development SMS Outbox (strictly 404 when NODE_ENV=production)
contactsRouter.get('/dev/outbox', async (_req: Request, res: Response) => {
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.ENVIRONMENT === 'production' ||
    config.environment === 'production'
  ) {
    res.status(404).json({ detail: 'Not found' });
    return;
  }

  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(sentMessages)
      .orderBy(desc(sentMessages.createdAt));

    res.status(200).json({
      provider: 'MockSmsProvider',
      messages: rows.map((r) => ({
        id: r.id,
        to_phone_e164: r.toPhoneE164,
        body: r.body,
        provider: r.provider,
        purpose: r.purpose,
        metadata: r.metadata,
        created_at: r.createdAt,
      })),
    });
  } catch {
    res.status(500).json({ detail: 'Failed to read dev outbox' });
  }
});
