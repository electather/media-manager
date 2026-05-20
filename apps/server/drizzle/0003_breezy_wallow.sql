CREATE TABLE `user_watchlist_seed` (
	`user_id` text PRIMARY KEY NOT NULL,
	`seeded_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `watchlist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tmdb_id` text NOT NULL,
	`media_type` text NOT NULL,
	`state` text NOT NULL,
	`source` text NOT NULL,
	`added_at` integer NOT NULL,
	`removed_at` integer,
	`seeded` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watchlist_items_user_tmdb_type_uq` ON `watchlist_items` (`user_id`,`tmdb_id`,`media_type`);--> statement-breakpoint
CREATE INDEX `watchlist_items_user_state_added_idx` ON `watchlist_items` (`user_id`,`state`,`added_at`);--> statement-breakpoint
CREATE INDEX `watchlist_items_user_state_idx` ON `watchlist_items` (`user_id`,`state`);