import { z } from 'zod';
import type {
  IncidentActorType,
  IncidentStatus,
  NotificationChannel,
  NotificationRecipientType,
  NotificationStatus,
} from '../db/schema';

export const locationSampleInputSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().nonnegative().nullable().optional(),
  captured_at: z.string().optional(),
});

export const createIncidentSchema = z.object({
  client_request_id: z.string().trim().min(1, 'client_request_id is required').max(128),
  client_created_at: z.string().optional(),
  location: locationSampleInputSchema.optional(),
  source_trigger: z.string().trim().min(1).max(64).default('button'),
  emergency_type: z.string().trim().min(1).max(64).nullable().optional(),
});

export const cancelIncidentSchema = z.object({
  pin: z.string().trim().optional(),
  note: z.string().trim().max(500).optional(),
});

export const setEmergencyTypeSchema = z.object({
  emergency_type: z.string().trim().min(1).max(64),
});

export const resolveIncidentSchema = z.object({
  resolution: z.enum(['RESOLVED', 'FALSE_ALARM']).default('RESOLVED'),
  note: z.string().trim().max(500).optional(),
});

export const updateCancelWindowSchema = z.object({
  cancel_window_seconds: z.number().int().min(0).max(10),
});

export const updateCancelPinSchema = z.object({
  pin: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, 'Cancel PIN must be 4 to 8 digits')
    .nullable(),
});

export const updateDuressPinSchema = z.object({
  pin: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, 'Duress PIN must be 4 to 8 digits')
    .nullable(),
  cancel_pin: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, 'Cancel PIN must be 4 to 8 digits')
    .nullable()
    .optional(),
});

export interface IncidentEventDto {
  id: string;
  incident_id: string;
  from_status: IncidentStatus | null;
  to_status: IncidentStatus;
  actor_type: IncidentActorType;
  actor_id: string | null;
  note: string | null;
  created_at: string;
}

export interface LocationSampleDto {
  id: string;
  incident_id: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  captured_at: string;
  expires_at: number;
}

export interface NotificationDto {
  id: string;
  incident_id: string;
  recipient_type: NotificationRecipientType;
  recipient_ref: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
}

export interface IncidentDto {
  id: string;
  user_id: string;
  status: IncidentStatus;
  emergency_type: string | null;
  client_request_id: string;
  created_at: string;
  activated_at: string | null;
  closed_at: string | null;
  merged_into_id: string | null;
  source_trigger: string;
  is_duress: boolean;
  needs_user_action: boolean;
  escalation_stage: number;
  auto_expire_minutes: number;
  notifiable_contacts_count?: number;
  events?: IncidentEventDto[];
  locations?: LocationSampleDto[];
  notifications?: NotificationDto[];
}
