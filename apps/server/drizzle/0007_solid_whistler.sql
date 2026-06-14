CREATE TABLE `app_bootstrap` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`consumed_at` integer
);
--> statement-breakpoint
ALTER TABLE `user` ADD `has_onboarded` integer DEFAULT false NOT NULL;
