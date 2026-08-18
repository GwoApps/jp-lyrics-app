CREATE TABLE `lyrics_provider_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`auth_type` text DEFAULT 'none' NOT NULL,
	`auth_secret_ciphertext` text,
	`enabled` integer DEFAULT 1 NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`timeout_ms` integer,
	`protocol_version` integer DEFAULT 1 NOT NULL,
	`manifest_json` text,
	`last_check_status` text DEFAULT 'unchecked' NOT NULL,
	`last_check_code` text,
	`last_check_latency_ms` integer,
	`checked_at` text,
	`created_at` text DEFAULT (datetime('now', 'localtime')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now', 'localtime')) NOT NULL
);
