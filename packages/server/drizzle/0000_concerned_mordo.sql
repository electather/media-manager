CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
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
	`shared_credentials` text,
	`shared_credentials_iv` text,
	`installed_by` text,
	`installed_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`installed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `service_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`status` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`is_default` integer DEFAULT 0 NOT NULL,
	`display_name` text,
	`user_config` text,
	`encrypted_credentials` text,
	`credentials_iv` text,
	`token_expires_at` integer,
	`last_verified_at` integer,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plugin_id`) REFERENCES `plugins`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `service_connections_user_plugin_idx` ON `service_connections` (`user_id`,`plugin_id`);--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tmdb_id` text NOT NULL,
	`media_type` text NOT NULL,
	`action` text NOT NULL,
	`rating` integer,
	`note` text,
	`extracted_signals` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `feedback_user_tmdb_idx` ON `feedback` (`user_id`,`tmdb_id`);--> statement-breakpoint
CREATE INDEX `feedback_user_created_at_idx` ON `feedback` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `preference_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`genre_scores` text NOT NULL,
	`theme_scores` text NOT NULL,
	`keyword_scores` text NOT NULL,
	`director_scores` text NOT NULL,
	`actor_scores` text NOT NULL,
	`rating_stats` text NOT NULL,
	`last_computed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `preference_profiles_user_id_unique` ON `preference_profiles` (`user_id`);--> statement-breakpoint
CREATE TABLE `id_map` (
	`tmdb_id` text NOT NULL,
	`media_type` text NOT NULL,
	`imdb_id` text,
	`tvdb_id` text,
	`trakt_id` text,
	`trakt_slug` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`tmdb_id`, `media_type`)
);
--> statement-breakpoint
CREATE INDEX `id_map_imdb_idx` ON `id_map` (`imdb_id`);--> statement-breakpoint
CREATE INDEX `id_map_tvdb_idx` ON `id_map` (`tvdb_id`);--> statement-breakpoint
CREATE INDEX `id_map_trakt_idx` ON `id_map` (`trakt_id`);--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role_id` text NOT NULL,
	`permission` text NOT NULL,
	PRIMARY KEY(`role_id`, `permission`),
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_system` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_name_unique` ON `roles` (`name`);--> statement-breakpoint
CREATE TABLE `user_roles` (
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`assigned_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_roles_user_id_unique` ON `user_roles` (`user_id`);--> statement-breakpoint
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
CREATE INDEX `error_records_severity_created_idx` ON `error_records` (`severity`,`created_at`);--> statement-breakpoint
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
