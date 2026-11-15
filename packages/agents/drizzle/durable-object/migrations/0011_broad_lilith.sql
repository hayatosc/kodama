CREATE TABLE `kodama_deferred_calls` (
	`approval_id` text PRIMARY KEY NOT NULL,
	`tool_name` text NOT NULL,
	`arguments_json` text NOT NULL,
	`reason` text NOT NULL,
	`source_task` text NOT NULL,
	`state` text NOT NULL,
	`operator_note` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`decided_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kodama_deferred_calls_source_task_unique` ON `kodama_deferred_calls` (`source_task`);--> statement-breakpoint
CREATE INDEX `kodama_deferred_calls_state` ON `kodama_deferred_calls` (`state`,`created_at`);--> statement-breakpoint
CREATE TABLE `kodama_event_inbox` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`source` text NOT NULL,
	`session_mode` text DEFAULT 'resume' NOT NULL,
	`when_busy` text DEFAULT 'followUp' NOT NULL,
	`payload_json` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`submission_id` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_retry_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`settled_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kodama_event_inbox_request_id_unique` ON `kodama_event_inbox` (`request_id`);--> statement-breakpoint
CREATE INDEX `kodama_event_inbox_pending` ON `kodama_event_inbox` (`state`,`next_retry_at`,`created_at`);--> statement-breakpoint
ALTER TABLE `kodama_always_loaded` ADD `tasks_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `kodama_notifications` ADD `details` text;--> statement-breakpoint
ALTER TABLE `kodama_notifications` ADD `delivery_state` text DEFAULT 'dispatched' NOT NULL;--> statement-breakpoint
ALTER TABLE `kodama_notifications` ADD `deliver_after` integer;--> statement-breakpoint
CREATE INDEX `kodama_notifications_delivery` ON `kodama_notifications` (`delivery_state`,`deliver_after`);--> statement-breakpoint
ALTER TABLE `kodama_scheduled_tasks` ADD `category` text DEFAULT 'schedule' NOT NULL;--> statement-breakpoint
ALTER TABLE `kodama_scheduled_tasks` ADD `followup_hop` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `kodama_scheduled_tasks` ADD `session_mode` text DEFAULT 'new' NOT NULL;