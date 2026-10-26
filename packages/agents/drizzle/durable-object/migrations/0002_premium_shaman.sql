PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_kodama_prune_runs` (
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
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_kodama_prune_runs`("id", "first_entry", "last_entry", "head", "state", "entry_count", "bytes", "sha256", "first_at", "last_at", "created_at", "updated_at") SELECT "id", "first_entry", "last_entry", "head", "state", "entry_count", "bytes", "sha256", "first_at", "last_at", "created_at", "updated_at" FROM `kodama_prune_runs`;--> statement-breakpoint
DROP TABLE `kodama_prune_runs`;--> statement-breakpoint
ALTER TABLE `__new_kodama_prune_runs` RENAME TO `kodama_prune_runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `kodama_prune_runs_by_state` ON `kodama_prune_runs` (`state`);