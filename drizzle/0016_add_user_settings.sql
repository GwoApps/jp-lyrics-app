CREATE TABLE `user_settings` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now', 'localtime')),
	PRIMARY KEY(`user_id`, `key`)
);
