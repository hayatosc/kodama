CREATE TABLE `kodama_external_data` (
	`root` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`contacted_at` integer NOT NULL,
	`eligible_through` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `kodama_web_permissions` (
	`key` text PRIMARY KEY NOT NULL,
	`root` text NOT NULL,
	`run` text,
	`input` integer,
	`tool` text NOT NULL,
	`argument` text NOT NULL,
	`consumed_at` integer
);
--> statement-breakpoint
ALTER TABLE `kodama_usage` ADD `kind` text DEFAULT 'model' NOT NULL;--> statement-breakpoint
ALTER TABLE `kodama_usage` ADD `tool` text;--> statement-breakpoint
ALTER TABLE `kodama_usage` ADD `root` text;--> statement-breakpoint
ALTER TABLE `kodama_usage` ADD `run` text;--> statement-breakpoint
ALTER TABLE `kodama_usage` ADD `task` text;--> statement-breakpoint
ALTER TABLE `kodama_usage` ADD `api` text;--> statement-breakpoint
ALTER TABLE `kodama_usage` ADD `argument` text;--> statement-breakpoint
ALTER TABLE `kodama_usage` ADD `admitted_at` integer;--> statement-breakpoint
ALTER TABLE `kodama_usage` ADD `keyless` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `kodama_usage` ADD `search_count` integer;--> statement-breakpoint
ALTER TABLE `kodama_usage` ADD `count_kind` text;--> statement-breakpoint
ALTER TABLE `kodama_usage` ADD `result_count` integer;--> statement-breakpoint
ALTER TABLE `kodama_usage` ADD `http_count` integer;--> statement-breakpoint
ALTER TABLE `kodama_usage` ADD `received_bytes` integer;--> statement-breakpoint
ALTER TABLE `kodama_usage` ADD `audit_json` text;--> statement-breakpoint
ALTER TABLE `kodama_usage` ADD `search_attempts` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `kodama_usage` ADD `search_session_id` text;