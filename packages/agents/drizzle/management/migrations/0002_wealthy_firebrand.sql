PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_credential_refs` (
	`agent_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`provider` text NOT NULL,
	`version` integer NOT NULL,
	PRIMARY KEY(`agent_id`, `provider`),
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`agent_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`credential_id`) REFERENCES `credentials`(`credential_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_agent_credential_refs`("agent_id", "credential_id", "provider", "version") SELECT "agent_id", "credential_id", "provider", "version" FROM `agent_credential_refs`;--> statement-breakpoint
DROP TABLE `agent_credential_refs`;--> statement-breakpoint
ALTER TABLE `__new_agent_credential_refs` RENAME TO `agent_credential_refs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `agent_credential_refs_by_credential` ON `agent_credential_refs` (`credential_id`);