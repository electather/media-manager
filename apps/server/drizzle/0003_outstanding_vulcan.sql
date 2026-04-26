CREATE TABLE `notification_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`event_payload` text NOT NULL,
	`recipient_connection_id` text,
	`recipient_user_id` text NOT NULL,
	`status` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`last_error_code` text,
	`provider_message_id` text,
	`correlation_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`recipient_connection_id`) REFERENCES `service_connections`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notification_deliveries_user_created_idx` ON `notification_deliveries` (`recipient_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notification_deliveries_status_updated_idx` ON `notification_deliveries` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `notification_deliveries_correlation_key_idx` ON `notification_deliveries` (`correlation_key`);--> statement-breakpoint
CREATE TABLE `notification_subscriptions` (
	`connection_id` text NOT NULL,
	`category` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`connection_id`, `category`),
	FOREIGN KEY (`connection_id`) REFERENCES `service_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notifications_inbox` (
	`id` text PRIMARY KEY NOT NULL,
	`delivery_id` text,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`severity` text NOT NULL,
	`category` text NOT NULL,
	`action_url` text,
	`image_url` text,
	`image_alt` text,
	`read_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`delivery_id`) REFERENCES `notification_deliveries`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_inbox_user_created_idx` ON `notifications_inbox` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_inbox_user_read_created_idx` ON `notifications_inbox` (`user_id`,`read_at`,`created_at`);