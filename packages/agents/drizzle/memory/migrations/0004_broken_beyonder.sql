CREATE TABLE `task_progress` (
	`agent_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`summary` text NOT NULL,
	`body` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`agent_id`, `slug`)
);
--> statement-breakpoint
CREATE INDEX `task_progress_by_status` ON `task_progress` (`agent_id`,`status`,`updated_at`);