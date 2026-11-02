CREATE TABLE `kodama_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`media_type` text NOT NULL,
	`size` integer NOT NULL,
	`storage_key` text NOT NULL,
	`state` text NOT NULL,
	`source_task` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kodama_artifacts_storage_key_unique` ON `kodama_artifacts` (`storage_key`);--> statement-breakpoint
CREATE INDEX `kodama_artifacts_expiry` ON `kodama_artifacts` (`expires_at`);--> statement-breakpoint
CREATE TABLE `kodama_contact_receipts` (
	`sender_agent_id` text NOT NULL,
	`request_id` text NOT NULL,
	`submission_id` integer NOT NULL,
	`result` text,
	`created_at` integer NOT NULL,
	`settled_at` integer,
	`acknowledged_at` integer,
	`expires_at` integer,
	PRIMARY KEY(`sender_agent_id`, `request_id`)
);
--> statement-breakpoint
CREATE INDEX `kodama_contact_receipts_submission` ON `kodama_contact_receipts` (`submission_id`);--> statement-breakpoint
CREATE INDEX `kodama_contact_receipts_expiry` ON `kodama_contact_receipts` (`expires_at`);--> statement-breakpoint
CREATE TABLE `kodama_contact_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`source_task` text NOT NULL,
	`source_entry` integer NOT NULL,
	`arguments` text NOT NULL,
	`target_agent_id` text NOT NULL,
	`request_id` text NOT NULL,
	`content` text NOT NULL,
	`hop` integer NOT NULL,
	`state` text NOT NULL,
	`submission_id` integer,
	`retry_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`result` text,
	`created_at` integer NOT NULL,
	`settled_at` integer,
	`expires_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kodama_contact_requests_source_task_unique` ON `kodama_contact_requests` (`source_task`);--> statement-breakpoint
CREATE UNIQUE INDEX `kodama_contact_requests_request_id_unique` ON `kodama_contact_requests` (`request_id`);--> statement-breakpoint
CREATE INDEX `kodama_contact_requests_pending` ON `kodama_contact_requests` (`state`,`retry_at`);--> statement-breakpoint
CREATE INDEX `kodama_contact_requests_expiry` ON `kodama_contact_requests` (`expires_at`);--> statement-breakpoint
CREATE TABLE `kodama_notifications` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`outcome` text NOT NULL,
	`summary` text NOT NULL,
	`artifact_ids` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`read_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kodama_notifications_source` ON `kodama_notifications` (`source`,`source_id`);--> statement-breakpoint
CREATE INDEX `kodama_notifications_unread` ON `kodama_notifications` (`read_at`,`seq`);--> statement-breakpoint
CREATE INDEX `kodama_notifications_expiry` ON `kodama_notifications` (`expires_at`);