ALTER TABLE `credentials` ADD `expires_at` integer;--> statement-breakpoint
ALTER TABLE `credentials` ADD `last_refreshed_at` integer;--> statement-breakpoint
ALTER TABLE `credentials` ADD `refresh_failures` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `credentials` ADD `last_refresh_failure_at` integer;--> statement-breakpoint
ALTER TABLE `credentials` ADD `last_refresh_failure_category` text;