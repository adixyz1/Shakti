ALTER TABLE `incidents` ADD `client_created_at` text;--> statement-breakpoint
ALTER TABLE `incidents` ADD `queued_offline` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE `post_incident_ratings` (
	`incident_id` text PRIMARY KEY NOT NULL,
	`score` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_post_incident_ratings_created_at` ON `post_incident_ratings` (`created_at`);
