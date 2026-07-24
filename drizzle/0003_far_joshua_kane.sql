ALTER TABLE `tracked_bets` ADD `closing_odds` integer;--> statement-breakpoint
ALTER TABLE `tracked_bets` ADD `closing_opposite_odds` integer;--> statement-breakpoint
ALTER TABLE `tracked_bets` ADD `closing_probability` real;--> statement-breakpoint
ALTER TABLE `tracked_bets` ADD `closing_line_value` real;--> statement-breakpoint
ALTER TABLE `tracked_bets` ADD `closing_captured_at` text;