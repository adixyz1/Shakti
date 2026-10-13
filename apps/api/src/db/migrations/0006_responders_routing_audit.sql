ALTER TABLE `users` ADD `organization_zone` text DEFAULT 'Demo Campus Zone' NOT NULL;--> statement-breakpoint
CREATE TABLE `responders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`organization_zone` text DEFAULT 'Demo Campus Zone' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`on_duty` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_responders_user_id` ON `responders` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_responders_org_zone` ON `responders` (`organization_zone`);--> statement-breakpoint
CREATE TABLE `incident_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`incident_id` text NOT NULL,
	`responder_id` text NOT NULL,
	`responder_user_id` text NOT NULL,
	`organization_zone` text NOT NULL,
	`assigned_by_user_id` text,
	`acknowledged_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_incident_assignments_pair` ON `incident_assignments` (`incident_id`,`responder_id`);--> statement-breakpoint
CREATE INDEX `idx_incident_assignments_incident_id` ON `incident_assignments` (`incident_id`);--> statement-breakpoint
CREATE INDEX `idx_incident_assignments_org_zone` ON `incident_assignments` (`organization_zone`);--> statement-breakpoint
CREATE TABLE `incident_access_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`incident_id` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_label` text,
	`action` text NOT NULL,
	`detail` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_incident_access_audit_incident_id` ON `incident_access_audit` (`incident_id`);--> statement-breakpoint
CREATE INDEX `idx_incident_access_audit_created_at` ON `incident_access_audit` (`created_at`);
