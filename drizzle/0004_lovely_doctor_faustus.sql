ALTER TABLE `songs` ADD `spotify_track_id` text;--> statement-breakpoint
ALTER TABLE `songs` ADD `spotify_uri` text;--> statement-breakpoint
ALTER TABLE `songs` ADD `spotify_album` text;--> statement-breakpoint
ALTER TABLE `songs` ADD `spotify_duration_ms` integer;--> statement-breakpoint
ALTER TABLE `songs` ADD `spotify_canonical_title` text;--> statement-breakpoint
ALTER TABLE `songs` ADD `spotify_canonical_artist` text;--> statement-breakpoint
ALTER TABLE `songs` ADD `lyrics_source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `songs` ADD `lyrics_confidence` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `songs` ADD `lyrics_fetched_at` text;