ALTER TABLE `notification_deliveries` ADD `next_attempt_at` integer;--> statement-breakpoint
CREATE INDEX `notification_deliveries_next_attempt_idx` ON `notification_deliveries` (`next_attempt_at`);