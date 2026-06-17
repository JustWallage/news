ALTER TABLE `curations` ADD `relevant` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `curations` ADD `pref_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `preferences` ADD `version` integer DEFAULT 1 NOT NULL;