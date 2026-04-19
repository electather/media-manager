CREATE TABLE `app_config` (
	`id` text PRIMARY KEY NOT NULL,
	`error_retention_days` integer DEFAULT 30 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `error_records` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`severity` text NOT NULL,
	`source` text NOT NULL,
	`code` text,
	`dev_message` text NOT NULL,
	`stack` text,
	`user_id` text,
	`plugin_id` text,
	`connection_id` text,
	`route` text,
	`http_status` integer,
	`context` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`plugin_id`) REFERENCES `plugins`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`connection_id`) REFERENCES `service_connections`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `error_records_created_idx` ON `error_records` (`created_at`);--> statement-breakpoint
CREATE INDEX `error_records_request_id_idx` ON `error_records` (`request_id`);--> statement-breakpoint
CREATE INDEX `error_records_plugin_created_idx` ON `error_records` (`plugin_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `error_records_severity_created_idx` ON `error_records` (`severity`,`created_at`);