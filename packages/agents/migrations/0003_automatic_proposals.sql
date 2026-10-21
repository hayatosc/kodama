PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_shared_proposals` (
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
	`applied_at` integer,
	CONSTRAINT "shared_proposals_target" CHECK("__new_shared_proposals"."target" IN ('record', 'skill')),
	CONSTRAINT "shared_proposals_status" CHECK("__new_shared_proposals"."status" IN ('accepted', 'applied', 'rejected', 'conflict')),
	CONSTRAINT "shared_proposals_applied" CHECK(("__new_shared_proposals"."status" = 'applied') = ("__new_shared_proposals"."applied_at" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_shared_proposals`("id", "space", "target", "target_key", "base_revision", "payload_json", "source_ids_json", "status", "run_id", "proposed_at", "decided_by", "reason", "applied_at") SELECT "id", "space", "target", "target_key", "base_revision", "payload_json", "source_ids_json", "status", "run_id", "proposed_at", "decided_by", "reason", "applied_at" FROM `shared_proposals`;--> statement-breakpoint
DROP TABLE `shared_proposals`;--> statement-breakpoint
ALTER TABLE `__new_shared_proposals` RENAME TO `shared_proposals`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `shared_proposals_by_status` ON `shared_proposals` (`status`,`space`,`proposed_at`);