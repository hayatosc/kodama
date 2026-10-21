CREATE TABLE `archive_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`first_entry` integer NOT NULL,
	`last_entry` integer NOT NULL,
	`entry_count` integer NOT NULL,
	`r2_prefix` text NOT NULL,
	`sha256` text NOT NULL,
	`bytes` integer NOT NULL,
	`first_at` integer NOT NULL,
	`last_at` integer NOT NULL,
	`has_summary` integer DEFAULT false NOT NULL,
	`extracted` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "archive_segments_range" CHECK("archive_segments"."first_entry" <= "archive_segments"."last_entry")
);
--> statement-breakpoint
CREATE INDEX `archive_segments_by_time` ON `archive_segments` (`agent_id`,`last_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `archive_segments_start` ON `archive_segments` (`agent_id`,`first_entry`);--> statement-breakpoint
CREATE TABLE `extraction_checkpoints` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`last_entry_id` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memory_ledger` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`run_id` text NOT NULL,
	`op_id` text,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target` text NOT NULL,
	`target_id` text NOT NULL,
	`detail_json` text
);
--> statement-breakpoint
CREATE INDEX `memory_ledger_by_target` ON `memory_ledger` (`target`,`target_id`,`seq`);--> statement-breakpoint
CREATE TABLE `memory_ops` (
	`op_id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`op` text NOT NULL,
	`result_json` text NOT NULL,
	`applied_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `memory_ops_by_job` ON `memory_ops` (`job_id`);--> statement-breakpoint
CREATE TABLE `memory_records` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`search_version` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`superseded_by` text,
	`origin` text NOT NULL,
	`source_agent_id` text NOT NULL,
	`source_entry_from` integer,
	`source_entry_to` integer,
	`run_id` text NOT NULL,
	`importance` real DEFAULT 0.5 NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`overrides` text,
	`required` integer DEFAULT false NOT NULL,
	`use_count` integer DEFAULT 0 NOT NULL,
	`last_used_at` integer,
	`observed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `memory_records_by_scope` ON `memory_records` (`scope`,`status`,`kind`,`importance`);--> statement-breakpoint
CREATE INDEX `memory_records_by_source` ON `memory_records` (`source_agent_id`,`source_entry_from`);--> statement-breakpoint
CREATE INDEX `memory_records_by_override` ON `memory_records` (`overrides`) WHERE "memory_records"."overrides" is not null;--> statement-breakpoint
CREATE TABLE `memory_terms` (
	`term` text NOT NULL,
	`record_id` text NOT NULL,
	PRIMARY KEY(`term`, `record_id`),
	FOREIGN KEY (`record_id`) REFERENCES `memory_records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_terms_by_record` ON `memory_terms` (`record_id`);--> statement-breakpoint
CREATE TABLE `revision_claims` (
	`target` text NOT NULL,
	`target_id` text NOT NULL,
	`revision` integer NOT NULL,
	`op_id` text NOT NULL,
	`claimed_at` integer NOT NULL,
	PRIMARY KEY(`target`, `target_id`, `revision`)
);
--> statement-breakpoint
CREATE INDEX `revision_claims_by_time` ON `revision_claims` (`claimed_at`);--> statement-breakpoint
CREATE TABLE `scope_revisions` (
	`scope` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shared_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`space` text NOT NULL,
	`target` text NOT NULL,
	`target_key` text NOT NULL,
	`base_revision` integer,
	`payload_json` text NOT NULL,
	`source_ids_json` text NOT NULL,
	`status` text NOT NULL,
	`run_id` text NOT NULL,
	`proposed_at` integer NOT NULL,
	`decided_by` text NOT NULL,
	`reason` text,
	`applied_at` integer
);
--> statement-breakpoint
CREATE INDEX `shared_proposals_by_status` ON `shared_proposals` (`status`,`space`,`proposed_at`);--> statement-breakpoint
CREATE TABLE `skill_usage` (
	`scope` text NOT NULL,
	`name` text NOT NULL,
	`agent_id` text NOT NULL,
	`use_count` integer DEFAULT 0 NOT NULL,
	`last_used_at` integer NOT NULL,
	PRIMARY KEY(`scope`, `name`, `agent_id`),
	FOREIGN KEY (`scope`,`name`) REFERENCES `skills`(`scope`,`name`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `skill_usage_by_agent` ON `skill_usage` (`agent_id`,`last_used_at`);--> statement-breakpoint
CREATE TABLE `skill_writes` (
	`op_id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`name` text NOT NULL,
	`base_revision` integer,
	`files_json` text NOT NULL,
	`skill_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `skill_writes_pending` ON `skill_writes` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `skills` (
	`scope` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`status` text NOT NULL,
	`r2_key` text NOT NULL,
	`content_sha256` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`evidence_json` text NOT NULL,
	`based_on` text,
	`absorbed_into` text,
	`pinned` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`scope`, `name`)
);
--> statement-breakpoint
CREATE INDEX `skills_by_status` ON `skills` (`scope`,`status`);--> statement-breakpoint
CREATE INDEX `skills_by_name` ON `skills` (`name`,`status`);