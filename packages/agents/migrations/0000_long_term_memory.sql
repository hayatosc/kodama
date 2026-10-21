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
	`detail_json` text,
	CONSTRAINT "memory_ledger_target" CHECK("memory_ledger"."target" IN ('record', 'skill', 'proposal'))
);
--> statement-breakpoint
CREATE INDEX `memory_ledger_by_target` ON `memory_ledger` (`target`,`target_id`,`seq`);--> statement-breakpoint
CREATE TABLE `memory_ops` (
	`op_id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`op` text NOT NULL,
	`result_json` text NOT NULL,
	`guard` integer NOT NULL,
	`applied_at` integer NOT NULL,
	CONSTRAINT "memory_ops_guard" CHECK("memory_ops"."guard" = 1)
);
--> statement-breakpoint
CREATE INDEX `memory_ops_by_job` ON `memory_ops` (`job_id`);--> statement-breakpoint
CREATE TABLE `memory_records` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`search_text` text NOT NULL,
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
	`revision` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "memory_records_scope" CHECK("memory_records"."scope" GLOB 'agent:*' OR "memory_records"."scope" GLOB 'shared:*'),
	CONSTRAINT "memory_records_kind" CHECK("memory_records"."kind" IN ('fact', 'event', 'instruction', 'task')),
	CONSTRAINT "memory_records_content" CHECK(length("memory_records"."content") BETWEEN 1 AND 2000),
	CONSTRAINT "memory_records_status" CHECK("memory_records"."status" IN ('active', 'superseded', 'invalid', 'archived')),
	CONSTRAINT "memory_records_origin" CHECK("memory_records"."origin" IN ('user_request', 'agent_judgment', 'extraction', 'consolidation', 'proposal')),
	CONSTRAINT "memory_records_importance" CHECK("memory_records"."importance" BETWEEN 0 AND 1),
	CONSTRAINT "memory_records_superseded" CHECK(("memory_records"."status" = 'superseded') = ("memory_records"."superseded_by" IS NOT NULL)),
	CONSTRAINT "memory_records_overrides" CHECK("memory_records"."overrides" IS NULL OR "memory_records"."scope" GLOB 'agent:*'),
	CONSTRAINT "memory_records_required" CHECK("memory_records"."required" = 0 OR ("memory_records"."scope" GLOB 'shared:*' AND "memory_records"."kind" IN ('fact', 'instruction')))
);
--> statement-breakpoint
CREATE INDEX `memory_records_by_scope` ON `memory_records` (`scope`,`status`,`kind`,`importance`);--> statement-breakpoint
CREATE INDEX `memory_records_by_source` ON `memory_records` (`source_agent_id`,`source_entry_from`);--> statement-breakpoint
CREATE INDEX `memory_records_by_override` ON `memory_records` (`overrides`) WHERE "memory_records"."overrides" IS NOT NULL;--> statement-breakpoint
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
	`status` text DEFAULT 'pending' NOT NULL,
	`run_id` text NOT NULL,
	`proposed_at` integer NOT NULL,
	`decided_at` integer,
	`decided_by` text,
	`reason` text,
	`applied_at` integer,
	CONSTRAINT "shared_proposals_target" CHECK("shared_proposals"."target" IN ('record', 'skill')),
	CONSTRAINT "shared_proposals_status" CHECK("shared_proposals"."status" IN ('pending', 'accepted', 'applied', 'rejected', 'conflict')),
	CONSTRAINT "shared_proposals_decided" CHECK(("shared_proposals"."status" = 'pending') = ("shared_proposals"."decided_at" IS NULL)),
	CONSTRAINT "shared_proposals_applied" CHECK(("shared_proposals"."status" = 'applied') = ("shared_proposals"."applied_at" IS NOT NULL))
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
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "skill_writes_status" CHECK("skill_writes"."status" IN ('pending', 'done'))
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
	PRIMARY KEY(`scope`, `name`),
	CONSTRAINT "skills_scope" CHECK("skills"."scope" GLOB 'agent:*' OR "skills"."scope" GLOB 'shared:*'),
	CONSTRAINT "skills_name" CHECK("skills"."name" NOT GLOB '*[^a-z0-9-]*' AND length("skills"."name") BETWEEN 1 AND 64),
	CONSTRAINT "skills_description" CHECK(length("skills"."description") BETWEEN 1 AND 1024),
	CONSTRAINT "skills_status" CHECK("skills"."status" IN ('proposed', 'active', 'stale', 'archived')),
	CONSTRAINT "skills_absorbed" CHECK("skills"."absorbed_into" IS NULL OR ("skills"."scope" GLOB 'agent:*' AND "skills"."status" = 'archived'))
);
--> statement-breakpoint
CREATE INDEX `skills_by_status` ON `skills` (`scope`,`status`);--> statement-breakpoint
CREATE INDEX `skills_by_name` ON `skills` (`name`,`status`);