CREATE TABLE `forecast_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` integer NOT NULL,
	`game_date` text NOT NULL,
	`starts_at` text NOT NULL,
	`model_version` text NOT NULL,
	`market` text NOT NULL,
	`selection_key` text NOT NULL,
	`line` real,
	`probability` real NOT NULL,
	`status` text NOT NULL,
	`outcome` integer,
	`brier` real,
	`created_at` text NOT NULL,
	`settled_at` text
);
--> statement-breakpoint
CREATE INDEX `forecast_status_game_idx` ON `forecast_snapshots` (`status`,`game_id`);--> statement-breakpoint
CREATE INDEX `forecast_market_date_idx` ON `forecast_snapshots` (`market`,`game_date`);