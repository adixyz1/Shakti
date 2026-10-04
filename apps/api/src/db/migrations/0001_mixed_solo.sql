CREATE TABLE `consents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`granted` integer NOT NULL,
	`created_at` text NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_consents_user_id` ON `consents` (`user_id`);--> statement-breakpoint
CREATE TABLE `contact_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_contact_invitations_contact_id` ON `contact_invitations` (`contact_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_contact_invitations_token_hash` ON `contact_invitations` (`token_hash`);--> statement-breakpoint
CREATE TABLE `sent_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`to_phone_e164` text NOT NULL,
	`body` text NOT NULL,
	`provider` text NOT NULL,
	`purpose` text NOT NULL,
	`metadata` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sent_messages_created_at` ON `sent_messages` (`created_at`);--> statement-breakpoint
CREATE TABLE `trusted_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`phone_e164` text NOT NULL,
	`priority_order` integer DEFAULT 1 NOT NULL,
	`permissions` text NOT NULL,
	`status` text DEFAULT 'invited' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_trusted_contacts_user_id` ON `trusted_contacts` (`user_id`);