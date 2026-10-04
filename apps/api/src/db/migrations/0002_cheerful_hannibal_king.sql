CREATE TABLE `incident_events` (
	`id` text PRIMARY KEY NOT NULL,
	`incident_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`note` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_incident_events_incident_id` ON `incident_events` (`incident_id`);--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`emergency_type` text,
	`client_request_id` text NOT NULL,
	`created_at` text NOT NULL,
	`activated_at` text,
	`closed_at` text,
	`merged_into_id` text,
	`source_trigger` text DEFAULT 'button' NOT NULL,
	`is_duress` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_incidents_user_id` ON `incidents` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_incidents_user_client_request` ON `incidents` (`user_id`,`client_request_id`);--> statement-breakpoint
CREATE TABLE `location_samples` (
	`id` text PRIMARY KEY NOT NULL,
	`incident_id` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`accuracy_m` real,
	`captured_at` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_location_samples_incident_id` ON `location_samples` (`incident_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `cancel_window_seconds` integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `duress_pin_hash` text;