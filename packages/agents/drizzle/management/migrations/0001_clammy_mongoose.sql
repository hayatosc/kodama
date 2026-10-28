CREATE TABLE `usage_daily` (
	`bucket` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`charged_agent_id` text NOT NULL,
	`credential_id` text,
	`credential_kind` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`actor_kind` text NOT NULL,
	`usage_state` text NOT NULL,
	`attempts` integer NOT NULL,
	`failed` integer NOT NULL,
	`rate_limited` integer NOT NULL,
	`input` integer NOT NULL,
	`output` integer NOT NULL,
	`cache_read` integer NOT NULL,
	`cache_write` integer NOT NULL,
	`total_tokens` integer NOT NULL,
	`reasoning` integer NOT NULL,
	`cache_write_1h` integer NOT NULL,
	`reasoning_reported` integer NOT NULL,
	`cache_write_1h_reported` integer NOT NULL,
	`cost_usd` real NOT NULL
);
--> statement-breakpoint
CREATE INDEX `usage_daily_by_day_agent` ON `usage_daily` (`day`,`charged_agent_id`);--> statement-breakpoint
CREATE TABLE `usage_ingestion` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`last_seq` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	`caught_up` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE `credentials` ADD `last_used_at` integer;