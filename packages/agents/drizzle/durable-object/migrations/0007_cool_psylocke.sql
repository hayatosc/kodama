CREATE TABLE `kodama_owner_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `kodama_owner_replies` (
	`request_id` text PRIMARY KEY NOT NULL,
	`external_message_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`principal_id` text NOT NULL,
	`arguments` text NOT NULL,
	`submission_id` integer,
	`state` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kodama_owner_replies_external_message_id_unique` ON `kodama_owner_replies` (`external_message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `kodama_owner_replies_sequence_unique` ON `kodama_owner_replies` (`sequence`);