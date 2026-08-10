CREATE TABLE `market_odds_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` integer,
	`provider_event_id` text,
	`game_date` text NOT NULL,
	`starts_at` text,
	`away_team` text NOT NULL,
	`home_team` text NOT NULL,
	`provider` text NOT NULL,
	`sportsbook` text NOT NULL,
	`market` text NOT NULL,
	`selection` text NOT NULL,
	`line` real,
	`american_odds` integer NOT NULL,
	`observed_at` text NOT NULL,
	`source_tier` text NOT NULL,
	`metadata_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `market_odds_game_market_idx` ON `market_odds_observations` (`game_id`,`market`,`observed_at`);--> statement-breakpoint
CREATE INDEX `market_odds_date_idx` ON `market_odds_observations` (`game_date`,`observed_at`);--> statement-breakpoint
CREATE INDEX `market_odds_provider_event_idx` ON `market_odds_observations` (`provider`,`provider_event_id`);