CREATE TABLE `journeys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`contact_id` text,
	`started_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`reminder_sent_at` text,
	`lapsed_notified_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_journeys_user_id` ON `journeys` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_journeys_status` ON `journeys` (`status`);
