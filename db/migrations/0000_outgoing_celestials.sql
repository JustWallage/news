CREATE TABLE `curations` (
	`user_email` text NOT NULL,
	`story_id` integer NOT NULL,
	`relevance_score` integer NOT NULL,
	`reason` text NOT NULL,
	`curated_at` integer NOT NULL,
	`current` integer NOT NULL,
	`opened_at` integer,
	PRIMARY KEY(`user_email`, `story_id`),
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `preferences` (
	`user_email` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stories` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`url` text,
	`by` text NOT NULL,
	`score` integer NOT NULL,
	`comments` integer NOT NULL,
	`time` integer NOT NULL,
	`fetched_at` integer NOT NULL
);
