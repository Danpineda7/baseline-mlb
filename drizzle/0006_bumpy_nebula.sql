CREATE TABLE `projection_archives` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` integer NOT NULL,
	`game_date` text NOT NULL,
	`starts_at` text NOT NULL,
	`model_version` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `projection_archive_date_idx` ON `projection_archives` (`game_date`,`game_id`);--> statement-breakpoint
CREATE INDEX `projection_archive_model_idx` ON `projection_archives` (`model_version`);