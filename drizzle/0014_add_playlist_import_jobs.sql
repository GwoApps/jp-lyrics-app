CREATE TABLE `playlist_import_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`playlist_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`processed` integer DEFAULT 0 NOT NULL,
	`imported` integer DEFAULT 0 NOT NULL,
	`skipped` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now', 'localtime')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now', 'localtime')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `playlist_import_track_results` (
	`job_id` text NOT NULL,
	`spotify_track_id` text NOT NULL,
	`title` text NOT NULL,
	`artist` text NOT NULL,
	`status` text NOT NULL,
	`needs_review` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY(`job_id`, `spotify_track_id`),
	FOREIGN KEY (`job_id`) REFERENCES `playlist_import_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `playlist_import_jobs_user_email_idx` ON `playlist_import_jobs` (`user_email`);
--> statement-breakpoint
CREATE INDEX `playlist_import_track_results_job_id_idx` ON `playlist_import_track_results` (`job_id`);
