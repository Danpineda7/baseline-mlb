CREATE TABLE `games` (
	`id` integer PRIMARY KEY NOT NULL,
	`season` integer NOT NULL,
	`game_date` text NOT NULL,
	`scheduled_at` text NOT NULL,
	`status` text NOT NULL,
	`away_team_id` integer NOT NULL,
	`home_team_id` integer NOT NULL,
	`venue_id` integer,
	`away_score` integer,
	`home_score` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`away_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`home_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `games_date_idx` ON `games` (`game_date`);--> statement-breakpoint
CREATE INDEX `games_teams_idx` ON `games` (`away_team_id`,`home_team_id`);--> statement-breakpoint
CREATE TABLE `lineups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`team_id` integer NOT NULL,
	`player_id` integer NOT NULL,
	`batting_order` integer NOT NULL,
	`position` text NOT NULL,
	`confirmed_at` text,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lineup_slot_uq` ON `lineups` (`game_id`,`team_id`,`batting_order`);--> statement-breakpoint
CREATE TABLE `model_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`model_name` text NOT NULL,
	`model_version` text NOT NULL,
	`trained_through` text NOT NULL,
	`generated_at` text NOT NULL,
	`feature_cutoff` text NOT NULL,
	`calibration_version` text NOT NULL,
	`metadata_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `odds_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`sportsbook` text NOT NULL,
	`market` text NOT NULL,
	`selection` text NOT NULL,
	`line` real,
	`american_odds` integer NOT NULL,
	`observed_at` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `odds_lookup_idx` ON `odds_snapshots` (`game_id`,`market`,`observed_at`);--> statement-breakpoint
CREATE TABLE `pitching_assignments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`team_id` integer NOT NULL,
	`player_id` integer NOT NULL,
	`role` text NOT NULL,
	`confirmed` integer NOT NULL,
	`expected_pitches` real,
	`rest_days` integer,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `players` (
	`id` integer PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`bats` text,
	`throws` text,
	`primary_position` text,
	`active` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `predictions` (
	`id` text PRIMARY KEY NOT NULL,
	`model_run_id` text NOT NULL,
	`game_id` integer NOT NULL,
	`market` text NOT NULL,
	`selection` text NOT NULL,
	`line` real,
	`probability` real NOT NULL,
	`fair_american_odds` integer NOT NULL,
	`uncertainty` real NOT NULL,
	`explanation_json` text NOT NULL,
	`generated_at` text NOT NULL,
	FOREIGN KEY (`model_run_id`) REFERENCES `model_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `predictions_game_idx` ON `predictions` (`game_id`,`market`);--> statement-breakpoint
CREATE TABLE `recommendations` (
	`id` text PRIMARY KEY NOT NULL,
	`prediction_id` text NOT NULL,
	`odds_snapshot_id` integer NOT NULL,
	`edge` real NOT NULL,
	`expected_value` real NOT NULL,
	`max_playable_odds` integer NOT NULL,
	`stake_units` real NOT NULL,
	`decision` text NOT NULL,
	`correlation_group` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`prediction_id`) REFERENCES `predictions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`odds_snapshot_id`) REFERENCES `odds_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settled_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recommendation_id` text NOT NULL,
	`result` text NOT NULL,
	`profit_units` real NOT NULL,
	`closing_odds` integer,
	`closing_line_value` real,
	`settled_at` text NOT NULL,
	FOREIGN KEY (`recommendation_id`) REFERENCES `recommendations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settled_recommendation_uq` ON `settled_results` (`recommendation_id`);--> statement-breakpoint
CREATE TABLE `source_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`endpoint` text NOT NULL,
	`parameters_json` text NOT NULL,
	`retrieved_at` text NOT NULL,
	`coverage_start` text,
	`coverage_end` text,
	`row_count` integer NOT NULL,
	`content_hash` text NOT NULL,
	`status` text NOT NULL,
	`validation_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `source_time_idx` ON `source_snapshots` (`source`,`retrieved_at`);--> statement-breakpoint
CREATE INDEX `source_hash_idx` ON `source_snapshots` (`content_hash`);--> statement-breakpoint
CREATE TABLE `teams` (
	`id` integer PRIMARY KEY NOT NULL,
	`abbreviation` text NOT NULL,
	`name` text NOT NULL,
	`league` text NOT NULL,
	`division` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teams_abbr_uq` ON `teams` (`abbreviation`);