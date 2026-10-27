CREATE TABLE `agent_config_versions` (
	`agent_id` text NOT NULL,
	`version` integer NOT NULL,
	`settings_json` text NOT NULL,
	`schema_version` integer NOT NULL,
	`author_id` text,
	`comment` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`agent_id`, `version`),
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`agent_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `principals`(`principal_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
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
CREATE TABLE `agent_members` (
	`agent_id` text NOT NULL,
	`principal_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`agent_id`, `principal_id`),
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`agent_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`principal_id`) REFERENCES `principals`(`principal_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_members_by_principal` ON `agent_members` (`principal_id`);--> statement-breakpoint
CREATE TABLE `agents` (
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
CREATE UNIQUE INDEX `agents_object_name_unique` ON `agents` (`object_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `agents_slug_unique` ON `agents` (`slug`);--> statement-breakpoint
CREATE INDEX `agents_by_status` ON `agents` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`op_id` text NOT NULL,
	`at` integer NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`detail_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `principals`(`principal_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_log_op_id_unique` ON `audit_log` (`op_id`);--> statement-breakpoint
CREATE INDEX `audit_log_by_target` ON `audit_log` (`target_id`,`seq`);--> statement-breakpoint
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
CREATE TABLE `principals` (
	`principal_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`external_id` text NOT NULL,
	`display_name` text NOT NULL,
	`system_role` text,
	`created_at` integer NOT NULL,
	`disabled_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `principals_external_id_unique` ON `principals` (`external_id`);--> statement-breakpoint
CREATE TABLE `system_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL
);
