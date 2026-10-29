ALTER TABLE `usage_daily` ADD `api` text;--> statement-breakpoint
ALTER TABLE `usage_daily` ADD `count_kind` text;--> statement-breakpoint
ALTER TABLE `usage_daily` ADD `search_count` integer;--> statement-breakpoint
ALTER TABLE `usage_daily` ADD `result_count` integer;--> statement-breakpoint
ALTER TABLE `usage_daily` ADD `http_count` integer;--> statement-breakpoint
ALTER TABLE `usage_daily` ADD `received_bytes` integer;--> statement-breakpoint
ALTER TABLE `usage_daily` ADD `tool_input` integer;--> statement-breakpoint
ALTER TABLE `usage_daily` ADD `tool_output` integer;