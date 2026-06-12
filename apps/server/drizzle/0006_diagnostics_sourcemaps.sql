CREATE TABLE `sourcemaps` (
	`id` text PRIMARY KEY NOT NULL,
	`build_id` text NOT NULL,
	`file_name` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sourcemaps_build_file_idx` ON `sourcemaps` (`build_id`,`file_name`);--> statement-breakpoint
CREATE INDEX `sourcemaps_file_created_idx` ON `sourcemaps` (`file_name`,`created_at`);--> statement-breakpoint
ALTER TABLE `error_records` ADD `resolved_stack` text;