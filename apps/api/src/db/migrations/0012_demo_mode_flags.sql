ALTER TABLE `incidents` ADD `is_demo` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `reports` ADD `is_demo` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `safety_pulses` ADD `is_demo` integer DEFAULT false NOT NULL;
