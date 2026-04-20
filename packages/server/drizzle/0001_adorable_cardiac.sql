CREATE TABLE `job_config` (
	`job_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`schedule_override` text,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `job_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`scope_key` text,
	`status` text NOT NULL,
	`triggered_by` text NOT NULL,
	`triggered_by_user_id` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`duration_ms` integer,
	`request_id` text NOT NULL,
	`rows_total` integer,
	`rows_succeeded` integer,
	`rows_failed` integer,
	`error_record_id` text,
	`result` text,
	`coalesced_count` integer,
	FOREIGN KEY (`triggered_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`error_record_id`) REFERENCES `error_records`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `job_runs_job_started_idx` ON `job_runs` (`job_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `job_runs_started_idx` ON `job_runs` (`started_at`);--> statement-breakpoint
CREATE INDEX `job_runs_status_started_idx` ON `job_runs` (`status`,`started_at`);--> statement-breakpoint
CREATE INDEX `job_runs_request_idx` ON `job_runs` (`request_id`);