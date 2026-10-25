CREATE TABLE `agent_credential_refs` (
	`agent_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`provider` text NOT NULL,
	`slot` text NOT NULL,
	`version` integer NOT NULL,
	PRIMARY KEY(`agent_id`, `provider`, `slot`),
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`agent_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`credential_id`) REFERENCES `credentials`(`credential_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_credential_refs_by_credential` ON `agent_credential_refs` (`credential_id`);--> statement-breakpoint
CREATE TABLE `credential_grants` (
	`credential_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`credential_id`, `agent_id`),
	FOREIGN KEY (`credential_id`) REFERENCES `credentials`(`credential_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`agent_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `credentials` (
	`credential_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`provider` text NOT NULL,
	`owner_scope` text NOT NULL,
	`owner_id` text,
	`status` text NOT NULL,
	`revision` integer NOT NULL,
	`kek_version` integer NOT NULL,
	`ciphertext` text,
	`iv` text,
	`wrapped_dek` text,
	`wrap_iv` text,
	`fingerprint` text NOT NULL,
	`last4` text NOT NULL,
	`lease_id` text,
	`lease_expires_at` integer,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	`revocation_recorded_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `principals`(`principal_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "credentials_owner" CHECK(("credentials"."owner_scope" = 'installation' and "credentials"."owner_id" is null and "credentials"."kind" = 'api_key') or ("credentials"."owner_scope" = 'principal' and "credentials"."owner_id" is not null)),
	CONSTRAINT "credentials_versions" CHECK("credentials"."revision" >= 1 and "credentials"."kek_version" >= 1),
	CONSTRAINT "credentials_payload" CHECK(("credentials"."status" = 'revoked' and "credentials"."ciphertext" is null and "credentials"."iv" is null and "credentials"."wrapped_dek" is null and "credentials"."wrap_iv" is null) or ("credentials"."status" <> 'revoked' and "credentials"."ciphertext" is not null and "credentials"."iv" is not null and "credentials"."wrapped_dek" is not null and "credentials"."wrap_iv" is not null)),
	CONSTRAINT "credentials_lease" CHECK(("credentials"."lease_id" is null and "credentials"."lease_expires_at" is null) or ("credentials"."lease_id" is not null and "credentials"."lease_expires_at" is not null))
);
