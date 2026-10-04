import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export type UserRole = 'user' | 'responder' | 'admin';
export type SupportedLanguage = 'en' | 'hi';

export const CONSENT_TYPES = [
  'location',
  'notifications',
  'microphone',
  'camera',
  'data_processing',
] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export const CONTACT_STATUSES = [
  'invited',
  'accepted',
  'paused',
  'removed',
] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export interface ContactPermissions {
  receives_sos: boolean;
  receives_checkin: boolean;
  can_see_live_location: boolean;
}

export const INCIDENT_STATUSES = [
  'TRIGGERED',
  'ACTIVE',
  'NOTIFIED',
  'ACKNOWLEDGED',
  'RESPONDING',
  'RESOLVED',
  'CANCELLED',
  'FALSE_ALARM',
  'EXPIRED',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const OPEN_INCIDENT_STATUSES: IncidentStatus[] = [
  'TRIGGERED',
  'ACTIVE',
  'NOTIFIED',
  'ACKNOWLEDGED',
  'RESPONDING',
];

export const TERMINAL_INCIDENT_STATUSES: IncidentStatus[] = [
  'RESOLVED',
  'CANCELLED',
  'FALSE_ALARM',
  'EXPIRED',
];

export const ACTOR_TYPES = [
  'user',
  'contact',
  'responder',
  'system',
] as const;
export type IncidentActorType = (typeof ACTOR_TYPES)[number];

export const NOTIFICATION_RECIPIENT_TYPES = [
  'contact',
  'responder',
  'gateway_112',
] as const;
export type NotificationRecipientType =
  (typeof NOTIFICATION_RECIPIENT_TYPES)[number];

export const NOTIFICATION_CHANNELS = ['push', 'sms', 'gateway'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATUSES = [
  'queued',
  'sent',
  'delivered',
  'failed',
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    phoneE164: text('phone_e164').notNull(),
    name: text('name').notNull(),
    role: text('role', { enum: ['user', 'responder', 'admin'] })
      .$type<UserRole>()
      .notNull()
      .default('user'),
    language: text('language', { enum: ['en', 'hi'] })
      .$type<SupportedLanguage>()
      .notNull()
      .default('en'),
    cancelWindowSeconds: integer('cancel_window_seconds').notNull().default(5),
    cancelPinHash: text('cancel_pin_hash'),
    duressPinHash: text('duress_pin_hash'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('idx_users_phone_e164').on(table.phoneE164)]
);

export const otpCodes = sqliteTable(
  'otp_codes',
  {
    id: text('id').primaryKey(),
    phoneE164: text('phone_e164').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: integer('expires_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_otp_codes_phone_e164').on(table.phoneE164)]
);

export const consents = sqliteTable(
  'consents',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    type: text('type', { enum: CONSENT_TYPES }).$type<ConsentType>().notNull(),
    granted: integer('granted', { mode: 'boolean' }).notNull(),
    createdAt: text('created_at').notNull(),
    source: text('source').notNull(),
  },
  (table) => [index('idx_consents_user_id').on(table.userId)]
);

export const trustedContacts = sqliteTable(
  'trusted_contacts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    phoneE164: text('phone_e164').notNull(),
    priorityOrder: integer('priority_order').notNull().default(1),
    permissions: text('permissions', { mode: 'json' })
      .$type<ContactPermissions>()
      .notNull(),
    status: text('status', { enum: CONTACT_STATUSES })
      .$type<ContactStatus>()
      .notNull()
      .default('invited'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_trusted_contacts_user_id').on(table.userId)]
);

export const contactInvitations = sqliteTable(
  'contact_invitations',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: integer('expires_at').notNull(),
    acceptedAt: text('accepted_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_contact_invitations_contact_id').on(table.contactId),
    uniqueIndex('idx_contact_invitations_token_hash').on(table.tokenHash),
  ]
);

export const sentMessages = sqliteTable(
  'sent_messages',
  {
    id: text('id').primaryKey(),
    toPhoneE164: text('to_phone_e164').notNull(),
    body: text('body').notNull(),
    provider: text('provider').notNull(),
    purpose: text('purpose').notNull(),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_sent_messages_created_at').on(table.createdAt)]
);

export const incidents = sqliteTable(
  'incidents',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    status: text('status', { enum: INCIDENT_STATUSES })
      .$type<IncidentStatus>()
      .notNull(),
    emergencyType: text('emergency_type'),
    clientRequestId: text('client_request_id').notNull(),
    createdAt: text('created_at').notNull(),
    activatedAt: text('activated_at'),
    closedAt: text('closed_at'),
    mergedIntoId: text('merged_into_id'),
    sourceTrigger: text('source_trigger').notNull().default('button'),
    isDuress: integer('is_duress', { mode: 'boolean' }).notNull().default(false),
    pinAttempts: integer('pin_attempts').notNull().default(0),
    needsUserAction: integer('needs_user_action', { mode: 'boolean' })
      .notNull()
      .default(false),
    escalationStage: integer('escalation_stage').notNull().default(0),
  },
  (table) => [
    index('idx_incidents_user_id').on(table.userId),
    uniqueIndex('idx_incidents_user_client_request').on(
      table.userId,
      table.clientRequestId
    ),
  ]
);

export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    incidentId: text('incident_id').notNull(),
    recipientType: text('recipient_type', {
      enum: NOTIFICATION_RECIPIENT_TYPES,
    })
      .$type<NotificationRecipientType>()
      .notNull(),
    recipientRef: text('recipient_ref').notNull(),
    channel: text('channel', { enum: NOTIFICATION_CHANNELS })
      .$type<NotificationChannel>()
      .notNull(),
    status: text('status', { enum: NOTIFICATION_STATUSES })
      .$type<NotificationStatus>()
      .notNull()
      .default('queued'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_notifications_incident_id').on(table.incidentId)]
);

export const incidentEvents = sqliteTable(
  'incident_events',
  {
    id: text('id').primaryKey(),
    incidentId: text('incident_id').notNull(),
    fromStatus: text('from_status', { enum: INCIDENT_STATUSES }).$type<
      IncidentStatus | null
    >(),
    toStatus: text('to_status', { enum: INCIDENT_STATUSES })
      .$type<IncidentStatus>()
      .notNull(),
    actorType: text('actor_type', { enum: ACTOR_TYPES })
      .$type<IncidentActorType>()
      .notNull(),
    actorId: text('actor_id'),
    note: text('note'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_incident_events_incident_id').on(table.incidentId)]
);

export const locationSamples = sqliteTable(
  'location_samples',
  {
    id: text('id').primaryKey(),
    incidentId: text('incident_id').notNull(),
    lat: real('lat').notNull(),
    lng: real('lng').notNull(),
    accuracyM: real('accuracy_m'),
    capturedAt: text('captured_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [index('idx_location_samples_incident_id').on(table.incidentId)]
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type OtpCodeRow = typeof otpCodes.$inferSelect;
export type NewOtpCodeRow = typeof otpCodes.$inferInsert;
export type ConsentRow = typeof consents.$inferSelect;
export type NewConsentRow = typeof consents.$inferInsert;
export type TrustedContactRow = typeof trustedContacts.$inferSelect;
export type NewTrustedContactRow = typeof trustedContacts.$inferInsert;
export type ContactInvitationRow = typeof contactInvitations.$inferSelect;
export type NewContactInvitationRow = typeof contactInvitations.$inferInsert;
export type SentMessageRow = typeof sentMessages.$inferSelect;
export type NewSentMessageRow = typeof sentMessages.$inferInsert;
export type IncidentRow = typeof incidents.$inferSelect;
export type NewIncidentRow = typeof incidents.$inferInsert;
export type IncidentEventRow = typeof incidentEvents.$inferSelect;
export type NewIncidentEventRow = typeof incidentEvents.$inferInsert;
export type LocationSampleRow = typeof locationSamples.$inferSelect;
export type NewLocationSampleRow = typeof locationSamples.$inferInsert;
export type NotificationRow = typeof notifications.$inferSelect;
export type NewNotificationRow = typeof notifications.$inferInsert;
