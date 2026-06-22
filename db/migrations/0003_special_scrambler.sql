CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`expires_at` integer NOT NULL
);
