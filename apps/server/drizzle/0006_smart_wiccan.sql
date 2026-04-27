CREATE TABLE `canonical_metadata` (
	`tmdb_id` text NOT NULL,
	`media_type` text NOT NULL,
	`title` text NOT NULL,
	`year` integer,
	`runtime_minutes` integer,
	`poster_url` text,
	`backdrop_url` text,
	`clear_logo_url` text,
	`thumb_url` text,
	`overview` text,
	`original_language` text,
	`genres` text,
	`features` text,
	`last_refreshed_at` integer NOT NULL,
	`last_accessed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`tmdb_id`, `media_type`)
);
--> statement-breakpoint
CREATE INDEX `canonical_metadata_last_refreshed_idx` ON `canonical_metadata` (`last_refreshed_at`);--> statement-breakpoint
CREATE INDEX `canonical_metadata_last_accessed_idx` ON `canonical_metadata` (`last_accessed_at`);--> statement-breakpoint
CREATE TABLE `discover_snapshots` (
	`feed_kind` text NOT NULL,
	`sort` text NOT NULL,
	`day` integer NOT NULL,
	`items` text NOT NULL,
	`generated_at` integer NOT NULL,
	PRIMARY KEY(`feed_kind`, `sort`, `day`)
);
--> statement-breakpoint
CREATE INDEX `discover_snapshots_day_idx` ON `discover_snapshots` (`day`);--> statement-breakpoint
CREATE TABLE `recommendation_lists` (
	`user_id` text NOT NULL,
	`list_kind` text NOT NULL,
	`items` text NOT NULL,
	`profile_version` integer NOT NULL,
	`generated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `list_kind`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_history_mirror` (
	`user_id` text PRIMARY KEY NOT NULL,
	`events` text NOT NULL,
	`plugin_cursors` text NOT NULL,
	`last_synced_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_ratings_mirror` (
	`user_id` text PRIMARY KEY NOT NULL,
	`events` text NOT NULL,
	`plugin_cursors` text NOT NULL,
	`last_synced_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `preference_profiles` ADD `version` integer DEFAULT 0 NOT NULL;