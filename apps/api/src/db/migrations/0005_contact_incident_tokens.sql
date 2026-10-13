CREATE TABLE `contact_incident_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`incident_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_contact_incident_tokens_hash` ON `contact_incident_tokens` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_contact_incident_tokens_pair` ON `contact_incident_tokens` (`incident_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `idx_contact_incident_tokens_incident_id` ON `contact_incident_tokens` (`incident_id`);
