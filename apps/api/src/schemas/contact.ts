import { z } from 'zod';
import { E164_REGEX } from './auth';
import type { ContactPermissions, ContactStatus } from '../db/schema';

export const contactPermissionsSchema = z.object({
  receives_sos: z.boolean(),
  receives_checkin: z.boolean(),
  can_see_live_location: z.boolean(),
});

export const createContactSchema = z.object({
  name: z.string().trim().min(1, 'Contact name is required').max(100),
  phone_e164: z
    .string()
    .trim()
    .regex(E164_REGEX, 'Phone number must be in valid E.164 format (e.g. +919876543210)'),
  permissions: contactPermissionsSchema.default({
    receives_sos: true,
    receives_checkin: true,
    can_see_live_location: false,
  }),
});

export const updateContactSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  phone_e164: z
    .string()
    .trim()
    .regex(E164_REGEX, 'Phone number must be in valid E.164 format')
    .optional(),
  permissions: contactPermissionsSchema.optional(),
});

export const reorderContactsSchema = z.object({
  ordered_ids: z.array(z.string().min(1)).min(1).max(5),
});

export interface TrustedContactDto {
  id: string;
  user_id: string;
  name: string;
  phone_e164: string;
  priority_order: number;
  permissions: ContactPermissions;
  status: ContactStatus;
  created_at: string;
  updated_at: string;
}

export interface PublicInvitationDto {
  inviter_name: string;
  contact_name: string;
  permissions: ContactPermissions;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  expires_at: string;
}
