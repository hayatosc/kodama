CREATE TABLE `mcp_assignments` (
	`agent_id` text NOT NULL,
	`server_id` text NOT NULL,
	`tool_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`digest` text NOT NULL,
	`server_revision` integer NOT NULL,
	PRIMARY KEY(`agent_id`, `tool_id`),
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`agent_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`server_id`) REFERENCES `mcp_servers`(`server_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tool_id`) REFERENCES `mcp_tools`(`tool_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`credential_id`) REFERENCES `credentials`(`credential_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `mcp_assignments_credential` ON `mcp_assignments` (`credential_id`);--> statement-breakpoint
CREATE TABLE `mcp_commits` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`authorized` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "mcp_commit_authorized" CHECK("mcp_commits"."authorized" = 1)
);
--> statement-breakpoint
CREATE TABLE `mcp_definitions` (
	`digest` text PRIMARY KEY NOT NULL,
	`definition_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcp_intents` (
	`intent_id` text PRIMARY KEY NOT NULL,
	`source_agent_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`entry_id` integer NOT NULL,
	`submission_id` text NOT NULL,
	`instruction_json` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer
);
--> statement-breakpoint
CREATE TABLE `mcp_oauth_clients` (
	`registration_id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`issuer` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`metadata_json` text,
	`secret_id` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `mcp_servers`(`server_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_oauth_client_binding` ON `mcp_oauth_clients` (`server_id`,`issuer`,`redirect_uri`);--> statement-breakpoint
CREATE TABLE `mcp_oauth_transactions` (
	`request_id` text,
	`transaction_id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`server_revision` integer NOT NULL,
	`state_digest` text NOT NULL,
	`browser_digest` text NOT NULL,
	`binding_json` text NOT NULL,
	`verifier_id` text NOT NULL,
	`status` text NOT NULL,
	`credential_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `mcp_servers`(`server_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_oauth_transactions_state_digest_unique` ON `mcp_oauth_transactions` (`state_digest`);--> statement-breakpoint
CREATE TABLE `mcp_proposals` (
	`proposal_id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`source_agent_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`server_id` text NOT NULL,
	`server_revision` integer NOT NULL,
	`catalog_digest` text NOT NULL,
	`credential_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`tool_ids_json` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcp_requests` (
	`request_id` text PRIMARY KEY NOT NULL,
	`source_agent_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`entry_id` integer NOT NULL,
	`submission_id` text NOT NULL,
	`server_id` text,
	`server_revision` integer,
	`credential_id` text,
	`status` text NOT NULL,
	`name` text NOT NULL,
	`notified_at` integer,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcp_servers` (
	`server_id` text PRIMARY KEY NOT NULL,
	`short_id` text NOT NULL,
	`name` text NOT NULL,
	`endpoint` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`catalog_digest` text,
	`catalog_version` integer DEFAULT 0 NOT NULL,
	`inspected_at` integer,
	`inspection_error` text,
	`stale` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_servers_short_id_unique` ON `mcp_servers` (`short_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_servers_endpoint_unique` ON `mcp_servers` (`endpoint`);--> statement-breakpoint
CREATE TABLE `mcp_tools` (
	`tool_id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`remote_name` text NOT NULL,
	`model_name` text NOT NULL,
	`server_revision` integer NOT NULL,
	`digest` text NOT NULL,
	`definition_json` text NOT NULL,
	`rejection` text,
	`present` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `mcp_servers`(`server_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_tools_model_name_unique` ON `mcp_tools` (`model_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_tool_remote_name` ON `mcp_tools` (`server_id`,`remote_name`);--> statement-breakpoint
ALTER TABLE `credentials` ADD `purpose` text DEFAULT 'model_provider' NOT NULL;--> statement-breakpoint
ALTER TABLE `credentials` ADD `mcp_auth_state` text;