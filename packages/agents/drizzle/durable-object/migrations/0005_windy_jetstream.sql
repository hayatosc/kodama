CREATE TABLE `kodama_scheduled_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`nominal_at` integer NOT NULL,
	`coalesced_from` integer NOT NULL,
	`state` text NOT NULL,
	`submission_id` integer,
	`retry_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`outcome` text,
	`settled_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `kodama_scheduled_tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kodama_scheduled_occurrences_nominal` ON `kodama_scheduled_occurrences` (`task_id`,`nominal_at`);--> statement-breakpoint
CREATE INDEX `kodama_scheduled_occurrences_pending` ON `kodama_scheduled_occurrences` (`state`,`retry_at`);--> statement-breakpoint
CREATE TABLE `kodama_scheduled_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`source_task` text NOT NULL,
	`source_entry` integer NOT NULL,
	`arguments` text NOT NULL,
	`instruction` text NOT NULL,
	`rule` text NOT NULL,
	`state` text NOT NULL,
	`next_due` integer,
	`cursor` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kodama_scheduled_tasks_source_task_unique` ON `kodama_scheduled_tasks` (`source_task`);--> statement-breakpoint
CREATE INDEX `kodama_scheduled_tasks_due` ON `kodama_scheduled_tasks` (`state`,`next_due`);