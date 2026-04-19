ALTER TABLE `plugins` ADD `shared_credentials` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `shared_credentials_iv` text;--> statement-breakpoint
CREATE TABLE `primary_connections` (
	`user_id` text NOT NULL,
	`capability_key` text NOT NULL,
	`media_type` text DEFAULT '_' NOT NULL,
	`connection_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `capability_key`, `media_type`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `service_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
