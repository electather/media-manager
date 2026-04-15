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
CREATE TABLE `service_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`service` text NOT NULL,
	`status` text NOT NULL,
	`display_name` text,
	`encrypted_config` text NOT NULL,
	`config_iv` text NOT NULL,
	`token_expires_at` integer,
	`last_verified_at` integer,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_connections_user_service_unique` ON `service_connections` (`user_id`,`service`);--> statement-breakpoint
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
CREATE INDEX `id_map_trakt_idx` ON `id_map` (`trakt_id`);