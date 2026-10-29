PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_usage_daily` (
	`bucket` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`charged_agent_id` text NOT NULL,
	`credential_id` text,
	`credential_kind` text,
	`kind` text DEFAULT 'model' NOT NULL,
	`tool` text,
	`provider` text,
	`model` text,
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
INSERT INTO `__new_usage_daily`("bucket", "day", "charged_agent_id", "credential_id", "credential_kind", "kind", "tool", "provider", "model", "actor_kind", "usage_state", "attempts", "failed", "rate_limited", "input", "output", "cache_read", "cache_write", "total_tokens", "reasoning", "cache_write_1h", "reasoning_reported", "cache_write_1h_reported", "cost_usd") SELECT "bucket", "day", "charged_agent_id", "credential_id", "credential_kind", "kind", "tool", "provider", "model", "actor_kind", "usage_state", "attempts", "failed", "rate_limited", "input", "output", "cache_read", "cache_write", "total_tokens", "reasoning", "cache_write_1h", "reasoning_reported", "cache_write_1h_reported", "cost_usd" FROM `usage_daily`;--> statement-breakpoint
DROP TABLE `usage_daily`;--> statement-breakpoint
ALTER TABLE `__new_usage_daily` RENAME TO `usage_daily`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `usage_daily_by_day_agent` ON `usage_daily` (`day`,`charged_agent_id`);