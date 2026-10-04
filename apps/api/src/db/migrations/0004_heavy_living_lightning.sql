CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`incident_id` text NOT NULL,
	`recipient_type` text NOT NULL,
	`recipient_ref` text NOT NULL,
	`channel` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_incident_id` ON `notifications` (`incident_id`);--> statement-breakpoint
ALTER TABLE `incidents` ADD `pin_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `incidents` ADD `needs_user_action` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `incidents` ADD `escalation_stage` integer DEFAULT 0 NOT NULL;