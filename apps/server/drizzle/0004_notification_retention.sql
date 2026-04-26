ALTER TABLE `app_config` ADD COLUMN `inbox_retention_days` integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE `app_config` ADD COLUMN `delivery_retention_days` integer DEFAULT 30 NOT NULL;
