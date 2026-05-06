CREATE TABLE `home_layout_cache` (
	`user_id` text PRIMARY KEY NOT NULL,
	`schema_version` integer NOT NULL,
	`blob` text NOT NULL,
	`generated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `home_layout_cache_generated_at_idx` ON `home_layout_cache` (`generated_at`);