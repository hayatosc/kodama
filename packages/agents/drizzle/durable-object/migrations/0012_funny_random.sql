ALTER TABLE `kodama_deferred_calls` ADD `tool_digest` text;--> statement-breakpoint
ALTER TABLE `kodama_event_inbox` ADD `batch_request_id` text;--> statement-breakpoint
CREATE INDEX `kodama_event_inbox_batch` ON `kodama_event_inbox` (`state`,`batch_request_id`);