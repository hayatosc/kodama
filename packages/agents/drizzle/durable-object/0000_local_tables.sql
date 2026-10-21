CREATE TABLE `kodama_always_loaded` (
	`id` integer PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`revisions_json` text NOT NULL,
	`skills_json` text DEFAULT '[]' NOT NULL,
	`checked_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `kodama_memory_jobs` (
	`job_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`priority` integer NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`outcome` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`not_before` integer NOT NULL,
	`submission_id` integer,
	`created_at` integer NOT NULL,
	`settled_at` integer
);
--> statement-breakpoint
CREATE INDEX `kodama_memory_jobs_next` ON `kodama_memory_jobs` (`status`,`priority`,`created_at`);--> statement-breakpoint
CREATE TABLE `kodama_prune_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`first_entry` integer NOT NULL,
	`last_entry` integer NOT NULL,
	`head` integer NOT NULL,
	`state` text NOT NULL,
	`entry_count` integer,
	`bytes` integer,
	`sha256` text,
	`first_at` integer,
	`last_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "kodama_prune_runs_range" CHECK("kodama_prune_runs"."first_entry" <= "kodama_prune_runs"."last_entry")
);
--> statement-breakpoint
CREATE INDEX `kodama_prune_runs_by_state` ON `kodama_prune_runs` (`state`);--> statement-breakpoint
CREATE TABLE `kodama_remember_turns` (
	`entry_id` integer PRIMARY KEY NOT NULL,
	`count` integer NOT NULL
);
