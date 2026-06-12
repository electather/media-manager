ALTER TABLE `roles` ADD `system_slug` text;--> statement-breakpoint
CREATE UNIQUE INDEX `roles_system_slug_unique` ON `roles` (`system_slug`);--> statement-breakpoint
-- Backfill by the stable seeded primary key, not the display name: an operator
-- who renamed the Admin role before this migration ran must still get the slug
-- stamped, otherwise the admin bypass stays broken — the very bug this fixes.
UPDATE `roles` SET `system_slug` = 'admin' WHERE `id` = 'role_admin' AND `is_system` = 1;