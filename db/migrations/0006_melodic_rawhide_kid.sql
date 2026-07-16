CREATE TABLE `feed_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`feed_id` integer NOT NULL,
	`link` text NOT NULL,
	`title` text NOT NULL,
	`published_at` integer,
	`fetched_at` integer NOT NULL,
	`relevant` integer DEFAULT true NOT NULL,
	`relevance_score` integer DEFAULT 0 NOT NULL,
	`pref_version` integer DEFAULT 0 NOT NULL,
	`current` integer NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`feed_id`) REFERENCES `feeds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feed_items_feed_id_link_idx` ON `feed_items` (`feed_id`,`link`);--> statement-breakpoint
CREATE TABLE `feed_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`feed_id` integer NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`feed_id`) REFERENCES `feeds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feed_sources_feed_id_url_idx` ON `feed_sources` (`feed_id`,`url`);--> statement-breakpoint
CREATE TABLE `feeds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_email` text NOT NULL,
	`title` text NOT NULL,
	`preferences_text` text DEFAULT '' NOT NULL,
	`pref_version` integer DEFAULT 1 NOT NULL,
	`slot1` integer,
	`slot2` integer,
	`slot3` integer,
	`last_fetched_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `feeds_user_email_idx` ON `feeds` (`user_email`);