CREATE TABLE `agent_credential_refs` (
	`agent_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`provider` text NOT NULL,
	PRIMARY KEY(`agent_id`, `provider`),
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`agent_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`credential_id`) REFERENCES `credentials`(`credential_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_credential_refs_by_credential` ON `agent_credential_refs` (`credential_id`);--> statement-breakpoint
CREATE TABLE `credential_grants` (
	`credential_id` text NOT NULL,
	`agent_id` text NOT NULL,
	PRIMARY KEY(`credential_id`, `agent_id`),
	FOREIGN KEY (`credential_id`) REFERENCES `credentials`(`credential_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`agent_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `credentials` (
	`credential_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`provider` text NOT NULL,
	`owner_id` text,
	`status` text NOT NULL,
	`revision` integer NOT NULL,
	`ciphertext` text,
	`iv` text,
	`wrapped_dek` text,
	`wrap_iv` text,
	`fingerprint` text NOT NULL,
	`last4` text NOT NULL,
	`lease_id` text,
	`lease_expires_at` integer,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `principals`(`principal_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agents` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`object_name` text NOT NULL,
	`kind` text NOT NULL,
	`display_name` text NOT NULL,
	`slug` text,
	`status` text NOT NULL,
	`purge_state` text,
	`current_version` integer NOT NULL,
	`applied_version` integer DEFAULT 0 NOT NULL,
	`owner_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `principals`(`principal_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_agents`("agent_id", "object_name", "kind", "display_name", "slug", "status", "purge_state", "current_version", "applied_version", "owner_id", "created_at", "updated_at") SELECT "agent_id", "object_name", "kind", "display_name", "slug", "status", "purge_state", "current_version", "applied_version", "owner_id", "created_at", "updated_at" FROM `agents`;--> statement-breakpoint
DROP TABLE `agents`;--> statement-breakpoint
ALTER TABLE `__new_agents` RENAME TO `agents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `agents_object_name_unique` ON `agents` (`object_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `agents_slug_unique` ON `agents` (`slug`);--> statement-breakpoint
CREATE INDEX `agents_by_status` ON `agents` (`status`,`created_at`);