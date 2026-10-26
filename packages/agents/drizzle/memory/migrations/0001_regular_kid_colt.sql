PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_archive_segments` (
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
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_archive_segments`("id", "agent_id", "first_entry", "last_entry", "entry_count", "r2_prefix", "sha256", "bytes", "first_at", "last_at", "has_summary", "created_at") SELECT "id", "agent_id", "first_entry", "last_entry", "entry_count", "r2_prefix", "sha256", "bytes", "first_at", "last_at", "has_summary", "created_at" FROM `archive_segments`;--> statement-breakpoint
DROP TABLE `archive_segments`;--> statement-breakpoint
ALTER TABLE `__new_archive_segments` RENAME TO `archive_segments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `archive_segments_by_time` ON `archive_segments` (`agent_id`,`last_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `archive_segments_start` ON `archive_segments` (`agent_id`,`first_entry`);