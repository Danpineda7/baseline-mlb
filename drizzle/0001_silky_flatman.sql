CREATE TABLE `tracked_bets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_key` text NOT NULL,
	`game_id` integer NOT NULL,
	`game_date` text NOT NULL,
	`starts_at` text,
	`matchup` text NOT NULL,
	`market` text NOT NULL,
	`selection` text NOT NULL,
	`line` real,
	`american_odds` integer NOT NULL,
	`opposite_odds` integer NOT NULL,
	`model_probability` real NOT NULL,
	`market_probability` real NOT NULL,
	`edge` real NOT NULL,
	`expected_value` real NOT NULL,
	`stake_units` real NOT NULL,
	`status` text NOT NULL,
	`profit_units` real,
	`created_at` text NOT NULL,
	`settled_at` text
);
--> statement-breakpoint
CREATE INDEX `tracked_owner_created_idx` ON `tracked_bets` (`owner_key`,`created_at`);--> statement-breakpoint
CREATE INDEX `tracked_open_game_idx` ON `tracked_bets` (`status`,`game_id`);