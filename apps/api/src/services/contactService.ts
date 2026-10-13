import crypto from 'crypto';
import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { getDb, type AppDatabase } from '../core/db';
import {
  createSignedInvitationToken,
  logger,
  verifyAndHashInvitationToken,
} from '../core/security';
import {
  consents,
  contactInvitations,
  trustedContacts,
  users,
  type ContactPermissions,
  type TrustedContactRow,
  type UserRow,
} from '../db/schema';
import { defaultSmsProvider, type SmsProvider } from '../providers/sms';
import type { PublicInvitationDto, TrustedContactDto } from '../schemas/contact';
import { HttpError } from './authService';

export const MAX_ACTIVE_CONTACTS = 5;
export const DEFAULT_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type NotifiablePurpose =
  | 'sos'
  | 'checkin'
  | 'live_location'
  | 'receives_sos'
  | 'receives_checkin'
  | 'can_see_live_location';

function resolvePermissionKey(purpose: NotifiablePurpose): keyof ContactPermissions {
  switch (purpose) {
    case 'sos':
    case 'receives_sos':
      return 'receives_sos';
    case 'checkin':
    case 'receives_checkin':
      return 'receives_checkin';
    case 'live_location':
    case 'can_see_live_location':
      return 'can_see_live_location';
  }
}

export function toTrustedContactDto(row: TrustedContactRow): TrustedContactDto {
  return {
    id: row.id,
    user_id: row.userId,
    name: row.name,
    phone_e164: row.phoneE164,
    priority_order: row.priorityOrder,
    permissions: row.permissions,
    status: row.status,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export async function listContactsForUser(
  db: AppDatabase,
  userId: string
): Promise<TrustedContactDto[]> {
  const rows = await db
    .select()
    .from(trustedContacts)
    .where(
      and(
        eq(trustedContacts.userId, userId),
        ne(trustedContacts.status, 'removed')
      )
    )
    .orderBy(asc(trustedContacts.priorityOrder), asc(trustedContacts.createdAt));

  return rows.map(toTrustedContactDto);
}

export async function createContactForUser(
  db: AppDatabase,
  user: UserRow,
  input: {
    name: string;
    phone_e164: string;
    permissions: ContactPermissions;
  },
  smsProvider: SmsProvider = defaultSmsProvider,
  invitationTtlMs: number = DEFAULT_INVITATION_TTL_MS
): Promise<{
  contact: TrustedContactDto;
  invitation_token: string;
  invitation_url: string;
  expires_at: string;
}> {
  const activeContacts = await db
    .select()
    .from(trustedContacts)
    .where(
      and(
        eq(trustedContacts.userId, user.id),
        ne(trustedContacts.status, 'removed')
      )
    )
    .orderBy(asc(trustedContacts.priorityOrder));

  if (activeContacts.length >= MAX_ACTIVE_CONTACTS) {
    throw new HttpError(
      400,
      `Maximum of ${MAX_ACTIVE_CONTACTS} active trusted contacts allowed.`
    );
  }

  const duplicate = activeContacts.find(
    (c) => c.phoneE164 === input.phone_e164
  );
  if (duplicate) {
    throw new HttpError(
      400,
      'This phone number is already in your trusted circle.'
    );
  }

  const nowIso = new Date().toISOString();
  const contactId = crypto.randomUUID();
  const priorityOrder = activeContacts.length + 1;

  const newContact: TrustedContactRow = {
    id: contactId,
    userId: user.id,
    name: input.name.trim(),
    phoneE164: input.phone_e164.trim(),
    priorityOrder,
    permissions: input.permissions,
    status: 'invited',
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await db.insert(trustedContacts).values(newContact);

  const { token, tokenHash } = createSignedInvitationToken();
  const expiresAtMs = Date.now() + invitationTtlMs;
  const expiresAtIso = new Date(expiresAtMs).toISOString();

  await db.insert(contactInvitations).values({
    id: crypto.randomUUID(),
    contactId,
    tokenHash,
    expiresAt: expiresAtMs,
    acceptedAt: null,
    createdAt: nowIso,
  });

  const invitationUrl = `/invite/${token}`;
  const smsBody = `${user.name} invited you to their SHAKTI Trusted Circle. Review permissions and accept or decline: ${invitationUrl}`;

  await smsProvider.sendSms({
    toPhoneE164: newContact.phoneE164,
    body: smsBody,
    purpose: 'contact_invitation',
    metadata: {
      contact_id: contactId,
      inviter_name: user.name,
      contact_name: newContact.name,
      invitation_url: invitationUrl,
      token,
      expires_at: expiresAtIso,
    },
  });

  return {
    contact: toTrustedContactDto(newContact),
    invitation_token: token,
    invitation_url: invitationUrl,
    expires_at: expiresAtIso,
  };
}

export async function updateContactForUser(
  db: AppDatabase,
  userId: string,
  contactId: string,
  input: {
    name?: string;
    phone_e164?: string;
    permissions?: ContactPermissions;
  }
): Promise<TrustedContactDto> {
  const [existing] = await db
    .select()
    .from(trustedContacts)
    .where(
      and(
        eq(trustedContacts.id, contactId),
        eq(trustedContacts.userId, userId),
        ne(trustedContacts.status, 'removed')
      )
    )
    .limit(1);

  if (!existing) {
    throw new HttpError(404, 'Trusted contact not found.');
  }

  const updatedName = input.name?.trim() ?? existing.name;
  const updatedPhone = input.phone_e164?.trim() ?? existing.phoneE164;
  const updatedPermissions = input.permissions ?? existing.permissions;
  const updatedAt = new Date().toISOString();

  await db
    .update(trustedContacts)
    .set({
      name: updatedName,
      phoneE164: updatedPhone,
      permissions: updatedPermissions,
      updatedAt,
    })
    .where(eq(trustedContacts.id, contactId));

  return toTrustedContactDto({
    ...existing,
    name: updatedName,
    phoneE164: updatedPhone,
    permissions: updatedPermissions,
    updatedAt,
  });
}

export async function reorderContactsForUser(
  db: AppDatabase,
  userId: string,
  orderedIds: string[]
): Promise<TrustedContactDto[]> {
  const active = await db
    .select()
    .from(trustedContacts)
    .where(
      and(
        eq(trustedContacts.userId, userId),
        ne(trustedContacts.status, 'removed')
      )
    )
    .orderBy(asc(trustedContacts.priorityOrder));

  const activeIdSet = new Set(active.map((c) => c.id));
  for (const id of orderedIds) {
    if (!activeIdSet.has(id)) {
      throw new HttpError(400, 'Invalid contact ID in reorder list.');
    }
  }

  const remainingIds = active
    .map((c) => c.id)
    .filter((id) => !orderedIds.includes(id));
  const finalOrder = [...orderedIds, ...remainingIds];

  const nowIso = new Date().toISOString();
  for (let i = 0; i < finalOrder.length; i++) {
    await db
      .update(trustedContacts)
      .set({ priorityOrder: i + 1, updatedAt: nowIso })
      .where(eq(trustedContacts.id, finalOrder[i]));
  }

  return listContactsForUser(db, userId);
}

export async function pauseContactForUser(
  db: AppDatabase,
  userId: string,
  contactId: string
): Promise<TrustedContactDto> {
  const [existing] = await db
    .select()
    .from(trustedContacts)
    .where(
      and(
        eq(trustedContacts.id, contactId),
        eq(trustedContacts.userId, userId),
        ne(trustedContacts.status, 'removed')
      )
    )
    .limit(1);

  if (!existing) {
    throw new HttpError(404, 'Trusted contact not found.');
  }

  const updatedAt = new Date().toISOString();
  await db
    .update(trustedContacts)
    .set({ status: 'paused', updatedAt })
    .where(eq(trustedContacts.id, contactId));

  return toTrustedContactDto({
    ...existing,
    status: 'paused',
    updatedAt,
  });
}

export async function resumeContactForUser(
  db: AppDatabase,
  userId: string,
  contactId: string
): Promise<TrustedContactDto> {
  const [existing] = await db
    .select()
    .from(trustedContacts)
    .where(
      and(
        eq(trustedContacts.id, contactId),
        eq(trustedContacts.userId, userId),
        ne(trustedContacts.status, 'removed')
      )
    )
    .limit(1);

  if (!existing) {
    throw new HttpError(404, 'Trusted contact not found.');
  }

  const invitations = await db
    .select()
    .from(contactInvitations)
    .where(eq(contactInvitations.contactId, contactId))
    .orderBy(desc(contactInvitations.createdAt));

  const hasAcceptedInvitation = invitations.some(
    (inv) => inv.acceptedAt && !inv.acceptedAt.startsWith('DECLINED:')
  );
  const restoredStatus = hasAcceptedInvitation ? 'accepted' : 'invited';
  const updatedAt = new Date().toISOString();

  await db
    .update(trustedContacts)
    .set({ status: restoredStatus, updatedAt })
    .where(eq(trustedContacts.id, contactId));

  return toTrustedContactDto({
    ...existing,
    status: restoredStatus,
    updatedAt,
  });
}

export async function removeContactForUser(
  db: AppDatabase,
  userId: string,
  contactId: string
): Promise<{ status: string; id: string }> {
  const [existing] = await db
    .select()
    .from(trustedContacts)
    .where(
      and(
        eq(trustedContacts.id, contactId),
        eq(trustedContacts.userId, userId),
        ne(trustedContacts.status, 'removed')
      )
    )
    .limit(1);

  if (!existing) {
    throw new HttpError(404, 'Trusted contact not found.');
  }

  const updatedAt = new Date().toISOString();
  await db
    .update(trustedContacts)
    .set({ status: 'removed', updatedAt })
    .where(eq(trustedContacts.id, contactId));

  // Normalize priority_order of remaining active contacts
  const remaining = await db
    .select()
    .from(trustedContacts)
    .where(
      and(
        eq(trustedContacts.userId, userId),
        ne(trustedContacts.status, 'removed')
      )
    )
    .orderBy(asc(trustedContacts.priorityOrder));

  for (let i = 0; i < remaining.length; i++) {
    await db
      .update(trustedContacts)
      .set({ priorityOrder: i + 1 })
      .where(eq(trustedContacts.id, remaining[i].id));
  }

  return { status: 'removed', id: contactId };
}

async function resolveInvitationRecord(db: AppDatabase, rawToken: string) {
  const tokenHash = verifyAndHashInvitationToken(rawToken);
  if (!tokenHash) {
    throw new HttpError(404, 'Invalid or tampered invitation token.');
  }

  const [invitation] = await db
    .select()
    .from(contactInvitations)
    .where(eq(contactInvitations.tokenHash, tokenHash))
    .limit(1);

  if (!invitation) {
    throw new HttpError(404, 'Invitation not found.');
  }

  const [contact] = await db
    .select()
    .from(trustedContacts)
    .where(eq(trustedContacts.id, invitation.contactId))
    .limit(1);

  if (!contact || contact.status === 'removed') {
    throw new HttpError(404, 'Invitation is no longer active.');
  }

  const [inviter] = await db
    .select()
    .from(users)
    .where(eq(users.id, contact.userId))
    .limit(1);

  if (!inviter) {
    throw new HttpError(404, 'Inviter account not found.');
  }

  return { invitation, contact, inviter };
}

export async function getInvitationDetailsByToken(
  db: AppDatabase,
  rawToken: string
): Promise<PublicInvitationDto> {
  const tokenHash = verifyAndHashInvitationToken(rawToken);
  if (!tokenHash) {
    throw new HttpError(404, 'Invalid or tampered invitation token.');
  }

  const [invitation] = await db
    .select()
    .from(contactInvitations)
    .where(eq(contactInvitations.tokenHash, tokenHash))
    .limit(1);

  if (!invitation) {
    throw new HttpError(404, 'Invitation not found.');
  }

  const [contact] = await db
    .select()
    .from(trustedContacts)
    .where(eq(trustedContacts.id, invitation.contactId))
    .limit(1);

  if (!contact) {
    throw new HttpError(404, 'Trusted contact record not found.');
  }

  const [inviter] = await db
    .select()
    .from(users)
    .where(eq(users.id, contact.userId))
    .limit(1);

  if (!inviter) {
    throw new HttpError(404, 'Inviter account not found.');
  }

  let status: PublicInvitationDto['status'] = 'pending';
  if (invitation.acceptedAt) {
    status = invitation.acceptedAt.startsWith('DECLINED:') ? 'declined' : 'accepted';
  } else if (Date.now() > invitation.expiresAt) {
    status = 'expired';
  }

  return {
    inviter_name: inviter.name,
    contact_name: contact.name,
    permissions: contact.permissions,
    status,
    expires_at: new Date(invitation.expiresAt).toISOString(),
  };
}

export async function acceptInvitationByToken(
  db: AppDatabase,
  rawToken: string
): Promise<{ status: string; contact: TrustedContactDto }> {
  const { invitation, contact } = await resolveInvitationRecord(db, rawToken);

  if (invitation.acceptedAt !== null) {
    throw new HttpError(400, 'Invitation token has already been used.');
  }

  if (Date.now() > invitation.expiresAt) {
    throw new HttpError(400, 'Invitation token has expired.');
  }

  const nowIso = new Date().toISOString();
  await db
    .update(contactInvitations)
    .set({ acceptedAt: nowIso })
    .where(eq(contactInvitations.id, invitation.id));

  await db
    .update(trustedContacts)
    .set({ status: 'accepted', updatedAt: nowIso })
    .where(eq(trustedContacts.id, contact.id));

  logger.info(`Trusted contact invitation accepted for contact_id=${contact.id}`);

  return {
    status: 'accepted',
    contact: toTrustedContactDto({
      ...contact,
      status: 'accepted',
      updatedAt: nowIso,
    }),
  };
}

export async function declineInvitationByToken(
  db: AppDatabase,
  rawToken: string
): Promise<{ status: string }> {
  const { invitation, contact } = await resolveInvitationRecord(db, rawToken);

  if (invitation.acceptedAt !== null) {
    throw new HttpError(400, 'Invitation token has already been used.');
  }

  if (Date.now() > invitation.expiresAt) {
    throw new HttpError(400, 'Invitation token has expired.');
  }

  const nowIso = new Date().toISOString();
  await db
    .update(contactInvitations)
    .set({ acceptedAt: `DECLINED:${nowIso}` })
    .where(eq(contactInvitations.id, invitation.id));

  await db
    .update(trustedContacts)
    .set({ status: 'removed', updatedAt: nowIso })
    .where(eq(trustedContacts.id, contact.id));

  logger.info(`Trusted contact invitation declined for contact_id=${contact.id}`);

  return { status: 'declined' };
}

/**
 * Single source-of-truth rule enforcement function for all phases (Task 3):
 * Returns ONLY contacts for `userId` that:
 * 1. Have `status === 'accepted'` (never `invited`, `paused`, or `removed`),
 * 2. Have the specific permission enabled for `purpose` (`receives_sos`, `receives_checkin`, or `can_see_live_location`),
 * 3. Are backed by an active `data_processing` consent in the user's consent ledger.
 *    Note: `location` consent is NEVER required for `sos` or `checkin` (only for `live_location`).
 */
export async function getNotifiableContacts(
  userId: string,
  purpose: NotifiablePurpose,
  dbInstance?: AppDatabase
): Promise<TrustedContactDto[]> {
  const db = dbInstance || getDb();
  const permissionKey = resolvePermissionKey(purpose);

  // Check user's append-only consent ledger
  const ledgerRows = await db
    .select()
    .from(consents)
    .where(eq(consents.userId, userId))
    .orderBy(desc(consents.createdAt));

  // Active data_processing consent is required before notifying any contact
  const latestDataProcessing = ledgerRows.find(
    (r) => r.type === 'data_processing'
  );
  if (!latestDataProcessing || !latestDataProcessing.granted) {
    return [];
  }

  // Location consent is only checked when purpose is live_location
  if (permissionKey === 'can_see_live_location') {
    const latestLocation = ledgerRows.find((r) => r.type === 'location');
    if (!latestLocation || !latestLocation.granted) {
      return [];
    }
  }

  const rows = await db
    .select()
    .from(trustedContacts)
    .where(
      and(
        eq(trustedContacts.userId, userId),
        eq(trustedContacts.status, 'accepted')
      )
    )
    .orderBy(asc(trustedContacts.priorityOrder), asc(trustedContacts.createdAt));

  return rows
    .filter((row) => Boolean(row.permissions?.[permissionKey]))
    .map(toTrustedContactDto);
}
