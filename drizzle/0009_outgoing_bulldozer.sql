CREATE TABLE `computed_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`computed_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `computed_kind_idx` ON `computed_artifacts` (`kind`,`expires_at`);--> statement-breakpoint
CREATE TABLE `system_events` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`severity` text NOT NULL,
	`detail_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `system_events_kind_idx` ON `system_events` (`kind`,`created_at`);--> statement-breakpoint
ALTER TABLE `tracked_bets` ADD `price_verified` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tracked_bets` ADD `retracted_at` text;--> statement-breakpoint
UPDATE `tracked_bets` SET `status`='RETRACTED', `retracted_at`=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE `status`='OPEN' AND `id` NOT IN (SELECT min(`id`) FROM `tracked_bets` WHERE `status`='OPEN' GROUP BY `owner_key`,`game_id`,`market`,`selection_key`,ifnull(`line`,-999),`mode`);--> statement-breakpoint
CREATE UNIQUE INDEX `tracked_open_unique_uq` ON `tracked_bets` (`owner_key`,`game_id`,`market`,`selection_key`,ifnull(`line`,-999),`mode`) WHERE `status`='OPEN';
