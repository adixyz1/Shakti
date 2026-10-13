CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`note` text,
	`anonymous` integer DEFAULT true NOT NULL,
	`user_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_reports_grid_coords` ON `reports` (`lat`,`lng`);
--> statement-breakpoint
CREATE INDEX `idx_reports_created_at` ON `reports` (`created_at`);
