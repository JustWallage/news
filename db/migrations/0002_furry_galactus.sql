CREATE TABLE `telegram` (
	`user_email` text PRIMARY KEY NOT NULL,
	`chat_id` integer,
	`chat_username` text,
	`chat_name` text,
	`link_code` text,
	`link_code_expires_at` integer,
	`slot1` integer,
	`slot2` integer,
	`slot3` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_chat_id_idx` ON `telegram` (`chat_id`);