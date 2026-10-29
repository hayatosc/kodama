PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_kodama_usage` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`charged_agent_id` text NOT NULL,
	`actor_kind` text NOT NULL,
	`job_id` text,
	`credential_id` text,
	`credential_kind` text,
	`kind` text DEFAULT 'model' NOT NULL,
	`tool` text,
	`root` text,
	`run` text,
	`task` text,
	`api` text,
	`argument` text,
	`admitted_at` integer,
	`keyless` integer DEFAULT false NOT NULL,
	`search_count` integer,
	`count_kind` text,
	`result_count` integer,
	`http_count` integer,
	`received_bytes` integer,
	`audit_json` text,
	`search_attempts` text DEFAULT '[]' NOT NULL,
	`search_session_id` text,
	`provider` text,
	`model` text,
	`response_model` text,
	`status` text DEFAULT 'in_flight' NOT NULL,
	`rate_limited` integer DEFAULT false NOT NULL,
	`usage_state` text DEFAULT 'unknown' NOT NULL,
	`input` integer,
	`output` integer,
	`cache_read` integer,
	`cache_write` integer,
	`total_tokens` integer,
	`reasoning` integer,
	`cache_write_1h` integer,
	`input_cost` real,
	`output_cost` real,
	`cache_read_cost` real,
	`cache_write_cost` real,
	`total_cost` real,
	`aggregated_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_kodama_usage`("seq", "started_at", "finished_at", "charged_agent_id", "actor_kind", "job_id", "credential_id", "credential_kind", "kind", "tool", "root", "run", "task", "api", "argument", "admitted_at", "keyless", "search_count", "count_kind", "result_count", "http_count", "received_bytes", "audit_json", "search_attempts", "search_session_id", "provider", "model", "response_model", "status", "rate_limited", "usage_state", "input", "output", "cache_read", "cache_write", "total_tokens", "reasoning", "cache_write_1h", "input_cost", "output_cost", "cache_read_cost", "cache_write_cost", "total_cost", "aggregated_at") SELECT "seq", "started_at", "finished_at", "charged_agent_id", "actor_kind", "job_id", "credential_id", "credential_kind", "kind", "tool", "root", "run", "task", "api", "argument", "admitted_at", "keyless", "search_count", "count_kind", "result_count", "http_count", "received_bytes", "audit_json", "search_attempts", "search_session_id", "provider", "model", "response_model", "status", "rate_limited", "usage_state", "input", "output", "cache_read", "cache_write", "total_tokens", "reasoning", "cache_write_1h", "input_cost", "output_cost", "cache_read_cost", "cache_write_cost", "total_cost", "aggregated_at" FROM `kodama_usage`;--> statement-breakpoint
DROP TABLE `kodama_usage`;--> statement-breakpoint
ALTER TABLE `__new_kodama_usage` RENAME TO `kodama_usage`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `kodama_usage_task_unique` ON `kodama_usage` (`task`);