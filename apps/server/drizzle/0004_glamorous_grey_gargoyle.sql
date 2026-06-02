CREATE TABLE `library_items` (
	`id` text NOT NULL,
	`user_id` text NOT NULL,
	`tmdb_id` text NOT NULL,
	`media_type` text NOT NULL,
	`owned` integer DEFAULT true NOT NULL,
	`owned_at` integer NOT NULL,
	`unowned_at` integer,
	`sort_title` text DEFAULT '' NOT NULL,
	`year` integer,
	`genres` text DEFAULT '[]' NOT NULL,
	`servers` text DEFAULT '[]' NOT NULL,
	`quality_tiers` text DEFAULT '[]' NOT NULL,
	`watched_state` text,
	`collection_id` text,
	`collection_name` text,
	`hydrated_at` integer,
	PRIMARY KEY(`user_id`, `id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_items_user_tmdb_type_uq` ON `library_items` (`user_id`,`tmdb_id`,`media_type`);--> statement-breakpoint
CREATE INDEX `library_items_user_owned_sort_id_idx` ON `library_items` (`user_id`,`owned`,`sort_title`,`id`);--> statement-breakpoint
CREATE INDEX `library_items_user_owned_year_id_idx` ON `library_items` (`user_id`,`owned`,`year`,`id`);--> statement-breakpoint
CREATE INDEX `library_items_user_owned_collection_idx` ON `library_items` (`user_id`,`owned`,`collection_id`);--> statement-breakpoint
CREATE TABLE `user_library_seed` (
	`user_id` text PRIMARY KEY NOT NULL,
	`seeded_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `canonical_metadata` ADD `collection_id` text;--> statement-breakpoint
ALTER TABLE `canonical_metadata` ADD `collection_name` text;