CREATE TABLE `resources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`phone` text NOT NULL,
	`description` text NOT NULL,
	`available_hours` text NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_resources_category` ON `resources` (`category`);
--> statement-breakpoint
CREATE INDEX `idx_resources_active` ON `resources` (`active`);
--> statement-breakpoint
CREATE TABLE `safety_pulses` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`safety_score` integer NOT NULL,
	`avoided_going_somewhere` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_safety_pulses_user_id` ON `safety_pulses` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_safety_pulses_created_at` ON `safety_pulses` (`created_at`);
