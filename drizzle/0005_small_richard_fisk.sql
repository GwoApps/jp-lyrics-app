ALTER TABLE `songs` ADD `reading_scheme` text DEFAULT 'ja-kana' NOT NULL;--> statement-breakpoint
ALTER TABLE `songs` ADD `reading_scheme_confirmed` integer DEFAULT 0 NOT NULL;