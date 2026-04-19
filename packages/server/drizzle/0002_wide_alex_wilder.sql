CREATE TABLE `pending_auth` (
	`nonce` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`state` text NOT NULL,
	`state_iv` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plugin_id`) REFERENCES `plugins`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `plugin_store` (
	`plugin_id` text NOT NULL,
	`user_id` text,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`plugin_id`, `user_id`, `key`),
	FOREIGN KEY (`plugin_id`) REFERENCES `plugins`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plugin_store_expires_idx` ON `plugin_store` (`expires_at`);--> statement-breakpoint
CREATE TABLE `plugins` (
	`id` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`source_url` text NOT NULL,
	`source_type` text NOT NULL,
	`checksum` text NOT NULL,
	`manifest` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`global_config` text,
	`global_config_iv` text,
	`installed_by` text,
	`installed_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`installed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
DROP INDEX `service_connections_user_service_unique`;--> statement-breakpoint
ALTER TABLE `service_connections` ADD `plugin_id` text NOT NULL REFERENCES plugins(id);--> statement-breakpoint
ALTER TABLE `service_connections` ADD `enabled` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `service_connections` ADD `is_default` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `service_connections` ADD `encrypted_user_config` text;--> statement-breakpoint
ALTER TABLE `service_connections` ADD `user_config_iv` text;--> statement-breakpoint
ALTER TABLE `service_connections` ADD `encrypted_credentials` text;--> statement-breakpoint
ALTER TABLE `service_connections` ADD `credentials_iv` text;--> statement-breakpoint
CREATE INDEX `service_connections_user_plugin_idx` ON `service_connections` (`user_id`,`plugin_id`);--> statement-breakpoint
ALTER TABLE `service_connections` DROP COLUMN `service`;--> statement-breakpoint
ALTER TABLE `service_connections` DROP COLUMN `encrypted_config`;--> statement-breakpoint
ALTER TABLE `service_connections` DROP COLUMN `config_iv`;