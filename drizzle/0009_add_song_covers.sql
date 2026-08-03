CREATE TABLE IF NOT EXISTS `song_covers` (
  `song_id` text PRIMARY KEY NOT NULL REFERENCES `songs`(`id`) ON DELETE cascade,
  `mime` text NOT NULL,
  `data` blob NOT NULL,
  `updated_at` text NOT NULL DEFAULT (datetime('now', 'localtime'))
);
