CREATE TABLE `perf_records` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`kind` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`route` text,
	`method` text,
	`status` integer,
	`plugin_id` text,
	`user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`plugin_id`) REFERENCES `plugins`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `perf_records_created_idx` ON `perf_records` (`created_at`);--> statement-breakpoint
CREATE INDEX `perf_records_kind_route_created_idx` ON `perf_records` (`kind`,`route`,`created_at`);--> statement-breakpoint
CREATE INDEX `perf_records_kind_plugin_created_idx` ON `perf_records` (`kind`,`plugin_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `perf_records_request_id_idx` ON `perf_records` (`request_id`);--> statement-breakpoint
ALTER TABLE `app_config` ADD `perf_retention_days` integer DEFAULT 7 NOT NULL;