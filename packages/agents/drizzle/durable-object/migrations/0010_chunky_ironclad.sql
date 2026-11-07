CREATE TABLE `kodama_mcp_calls` (
	`call_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`tool_id` text NOT NULL,
	`state` text NOT NULL,
	`failure` text,
	`created_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `kodama_mcp_calls_run` ON `kodama_mcp_calls` (`run_id`,`tool_id`);