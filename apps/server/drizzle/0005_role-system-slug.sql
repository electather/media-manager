ALTER TABLE `roles` ADD `system_slug` text;--> statement-breakpoint
CREATE UNIQUE INDEX `roles_system_slug_unique` ON `roles` (`system_slug`);--> statement-breakpoint
UPDATE `roles` SET `system_slug` = 'admin' WHERE `is_system` = 1 AND `name` = 'Admin';