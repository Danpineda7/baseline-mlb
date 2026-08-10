ALTER TABLE `tracked_bets` ADD `mode` text DEFAULT 'REAL' NOT NULL;--> statement-breakpoint
ALTER TABLE `tracked_bets` ADD `decision` text DEFAULT 'BET' NOT NULL;--> statement-breakpoint
ALTER TABLE `tracked_bets` ADD `evidence_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX `tracked_mode_status_idx` ON `tracked_bets` (`mode`,`status`,`created_at`);