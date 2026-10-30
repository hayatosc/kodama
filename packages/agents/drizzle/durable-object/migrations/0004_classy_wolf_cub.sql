CREATE TABLE `kodama_known_urls` (
	`root` text NOT NULL,
	`url` text NOT NULL,
	`source` text NOT NULL,
	`granted_at` integer NOT NULL,
	PRIMARY KEY(`root`, `url`)
);
--> statement-breakpoint
CREATE INDEX `kodama_known_urls_by_age` ON `kodama_known_urls` (`root`,`granted_at`);--> statement-breakpoint
DROP TABLE `kodama_web_permissions`;