DROP TABLE `agent_members`;--> statement-breakpoint
DROP TABLE `principals`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_config_versions` (
	`agent_id` text NOT NULL,
	`version` integer NOT NULL,
	`settings_json` text NOT NULL,
	`schema_version` integer NOT NULL,
	`source` text NOT NULL,
	`comment` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`agent_id`, `version`),
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`agent_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_agent_config_versions`("agent_id", "version", "settings_json", "schema_version", "source", "comment", "created_at") SELECT "agent_id", "version", "settings_json", "schema_version", "source", "comment", "created_at" FROM `agent_config_versions`;--> statement-breakpoint
DROP TABLE `agent_config_versions`;--> statement-breakpoint
ALTER TABLE `__new_agent_config_versions` RENAME TO `agent_config_versions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
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
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_agents`("agent_id", "object_name", "kind", "display_name", "slug", "status", "purge_state", "current_version", "applied_version", "created_at", "updated_at") SELECT "agent_id", "object_name", "kind", "display_name", "slug", "status", "purge_state", "current_version", "applied_version", "created_at", "updated_at" FROM `agents`;--> statement-breakpoint
DROP TABLE `agents`;--> statement-breakpoint
ALTER TABLE `__new_agents` RENAME TO `agents`;--> statement-breakpoint
CREATE UNIQUE INDEX `agents_object_name_unique` ON `agents` (`object_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `agents_slug_unique` ON `agents` (`slug`);--> statement-breakpoint
CREATE INDEX `agents_by_status` ON `agents` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_audit_log` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`op_id` text NOT NULL,
	`at` integer NOT NULL,
	`source` text NOT NULL,
	`action` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`detail_json` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_audit_log`("seq", "op_id", "at", "source", "action", "target_kind", "target_id", "detail_json") SELECT "seq", "op_id", "at", "source", "action", "target_kind", "target_id", "detail_json" FROM `audit_log`;--> statement-breakpoint
DROP TABLE `audit_log`;--> statement-breakpoint
ALTER TABLE `__new_audit_log` RENAME TO `audit_log`;--> statement-breakpoint
CREATE UNIQUE INDEX `audit_log_op_id_unique` ON `audit_log` (`op_id`);--> statement-breakpoint
CREATE INDEX `audit_log_by_target` ON `audit_log` (`target_id`,`seq`);--> statement-breakpoint
CREATE TABLE `__new_credentials` (
	`credential_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`provider` text NOT NULL,
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
	`last_used_at` integer,
	`expires_at` integer,
	`last_refreshed_at` integer,
	`refresh_failures` integer DEFAULT 0 NOT NULL,
	`last_refresh_failure_at` integer,
	`last_refresh_failure_category` text
);
--> statement-breakpoint
INSERT INTO `__new_credentials`("credential_id", "kind", "provider", "status", "revision", "ciphertext", "iv", "wrapped_dek", "wrap_iv", "fingerprint", "last4", "lease_id", "lease_expires_at", "created_at", "revoked_at", "last_used_at", "expires_at", "last_refreshed_at", "refresh_failures", "last_refresh_failure_at", "last_refresh_failure_category") SELECT "credential_id", "kind", "provider", "status", "revision", "ciphertext", "iv", "wrapped_dek", "wrap_iv", "fingerprint", "last4", "lease_id", "lease_expires_at", "created_at", "revoked_at", "last_used_at", "expires_at", "last_refreshed_at", "refresh_failures", "last_refresh_failure_at", "last_refresh_failure_category" FROM `credentials`;--> statement-breakpoint
DROP TABLE `credentials`;--> statement-breakpoint
ALTER TABLE `__new_credentials` RENAME TO `credentials`;--> statement-breakpoint
CREATE UNIQUE INDEX `credentials_id_provider` ON `credentials` (`credential_id`,`provider`);