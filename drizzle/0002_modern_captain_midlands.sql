PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_songs` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`artist` text DEFAULT '' NOT NULL,
	`lyrics_raw` text DEFAULT '' NOT NULL,
	`lyrics_furigana` text DEFAULT '[]' NOT NULL,
	`lyrics_synced` text DEFAULT '' NOT NULL,
	`created_by` text DEFAULT '' NOT NULL,
	`created_by_name` text DEFAULT '' NOT NULL,
	`is_public` integer DEFAULT 0 NOT NULL,
	`public_requested` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now', 'localtime')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now', 'localtime')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_songs`("id", "title", "artist", "lyrics_raw", "lyrics_furigana", "lyrics_synced", "created_by", "created_by_name", "is_public", "public_requested", "created_at", "updated_at") SELECT "id", "title", "artist", "lyrics_raw", "lyrics_furigana", "lyrics_synced", "created_by", "created_by_name", "is_public", "public_requested", "created_at", "updated_at" FROM `songs`;--> statement-breakpoint
DROP TABLE `songs`;--> statement-breakpoint
ALTER TABLE `__new_songs` RENAME TO `songs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;