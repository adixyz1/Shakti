CREATE TABLE `safety_tools` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`safe_use_notes` text NOT NULL,
	`legal_note` text NOT NULL,
	`link_url` text,
	`link_label` text NOT NULL,
	`last_checked` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`is_affiliate` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_safety_tools_category` ON `safety_tools` (`category`);
--> statement-breakpoint
CREATE INDEX `idx_safety_tools_active` ON `safety_tools` (`active`);
