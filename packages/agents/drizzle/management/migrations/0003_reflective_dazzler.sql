PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_credentials` (
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
	CONSTRAINT "credentials_owner" CHECK(("__new_credentials"."owner_scope" = 'installation' and "__new_credentials"."owner_id" is null) or ("__new_credentials"."owner_scope" = 'principal' and "__new_credentials"."owner_id" is not null)),
	CONSTRAINT "credentials_versions" CHECK("__new_credentials"."revision" >= 1 and "__new_credentials"."kek_version" >= 1),
	CONSTRAINT "credentials_payload" CHECK(("__new_credentials"."status" = 'revoked' and "__new_credentials"."ciphertext" is null and "__new_credentials"."iv" is null and "__new_credentials"."wrapped_dek" is null and "__new_credentials"."wrap_iv" is null) or ("__new_credentials"."status" <> 'revoked' and "__new_credentials"."ciphertext" is not null and "__new_credentials"."iv" is not null and "__new_credentials"."wrapped_dek" is not null and "__new_credentials"."wrap_iv" is not null)),
	CONSTRAINT "credentials_lease" CHECK(("__new_credentials"."lease_id" is null and "__new_credentials"."lease_expires_at" is null) or ("__new_credentials"."lease_id" is not null and "__new_credentials"."lease_expires_at" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_credentials`("credential_id", "kind", "provider", "owner_scope", "owner_id", "status", "revision", "kek_version", "ciphertext", "iv", "wrapped_dek", "wrap_iv", "fingerprint", "last4", "lease_id", "lease_expires_at", "created_at", "last_used_at", "revoked_at", "revocation_recorded_at") SELECT "credential_id", "kind", "provider", "owner_scope", "owner_id", "status", "revision", "kek_version", "ciphertext", "iv", "wrapped_dek", "wrap_iv", "fingerprint", "last4", "lease_id", "lease_expires_at", "created_at", "last_used_at", "revoked_at", "revocation_recorded_at" FROM `credentials`;--> statement-breakpoint
DROP TABLE `credentials`;--> statement-breakpoint
ALTER TABLE `__new_credentials` RENAME TO `credentials`;--> statement-breakpoint
PRAGMA foreign_keys=ON;