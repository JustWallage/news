ALTER TABLE `curations` ADD `last_shown_at` integer;--> statement-breakpoint
-- Backfill: rows relevant at their last evaluation were in the feed then, so
-- `curated_at` is the best available stand-in. Rows judged irrelevant since are
-- unrecoverable and stay null (they drop out of the archive).
UPDATE `curations` SET `last_shown_at` = `curated_at` WHERE `relevant` = 1;
