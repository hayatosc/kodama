CREATE TABLE `kodama_external_data` (
	`root` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`contacted_at` integer NOT NULL,
	`eligible_through` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `kodama_web_permissions` (
	`key` text PRIMARY KEY NOT NULL,
	`root` text NOT NULL,
	`run` text,
	`input` integer,
	`tool` text NOT NULL,
	`argument` text NOT NULL,
	`consumed_at` integer
);
