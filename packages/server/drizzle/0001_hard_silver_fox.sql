ALTER TABLE `job_config` ADD `log_level` text DEFAULT 'info' NOT NULL;--> statement-breakpoint
ALTER TABLE `job_runs` ADD `logs` text;--> statement-breakpoint
ALTER TABLE `job_runs` ADD `logs_truncated` integer DEFAULT 0;--> statement-breakpoint
CREATE INDEX `job_runs_scope_key_idx` ON `job_runs` (`scope_key`);