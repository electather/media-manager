-- Replaces the v0 single-row preference_profiles with a per-media-type
-- schema that stores features as a single JSON blob. Also restructures
-- feedback to store per-note sentiment + keyword extractions inline.
DROP INDEX IF EXISTS `preference_profiles_user_id_unique`;
--> statement-breakpoint
DROP TABLE IF EXISTS `preference_profiles`;
--> statement-breakpoint
CREATE TABLE `preference_profiles` (
	`user_id` text NOT NULL,
	`media_type` text NOT NULL,
	`features` text NOT NULL,
	`sample_size` integer NOT NULL,
	`confidence` text NOT NULL,
	`last_rebuilt_at` integer NOT NULL,
	`last_updated_at` integer NOT NULL,
	`embedding` blob,
	`embedding_model` text,
	PRIMARY KEY(`user_id`, `media_type`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
DROP INDEX IF EXISTS `feedback_user_tmdb_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `feedback_user_created_at_idx`;
--> statement-breakpoint
DROP TABLE IF EXISTS `feedback`;
--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tmdb_id` text NOT NULL,
	`media_type` text NOT NULL,
	`action` text NOT NULL,
	`rating` integer,
	`note` text,
	`note_sentiment` text,
	`note_keywords` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `feedback_user_created_at_idx` ON `feedback` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `feedback_user_item_idx` ON `feedback` (`user_id`,`tmdb_id`,`media_type`);
