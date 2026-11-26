-- ISSUE #485 — one translation cache per target language per song.
--
-- The legacy columns (`songs.lyrics_translation` + `lyrics_translation_lang`)
-- hold at most one language, so switching the target language invalidates the
-- whole song's translation and forces a paid re-translation. This migration
-- adds a per-language table and seeds it from the legacy single cache without
-- dropping anything: every existing translation stays readable under its
-- recorded language (unknown stamps are kept under the default `zh-CN` tag
-- for display purposes only). Old columns remain as the compatibility mirror
-- until the app writes/reads the new table.
CREATE TABLE IF NOT EXISTS `song_translations` (
  `song_id` text NOT NULL REFERENCES `songs`(`id`) ON DELETE cascade,
  `lang` text NOT NULL,
  `lines` text NOT NULL DEFAULT '[]',
  `reasoning` text,
  `updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  PRIMARY KEY (`song_id`, `lang`)
);
--> statement-breakpoint
INSERT INTO `song_translations` (`song_id`, `lang`, `lines`, `reasoning`, `updated_at`)
SELECT `id`,
       COALESCE(NULLIF(TRIM(`lyrics_translation_lang`), ''), 'zh-CN'),
       `lyrics_translation`,
       `lyrics_translation_reasoning`,
       `updated_at`
FROM `songs`
WHERE `lyrics_translation` IS NOT NULL
  AND `lyrics_translation` <> ''
  AND `lyrics_translation` <> '[]'
  AND NOT EXISTS (
    SELECT 1 FROM `song_translations` st
    WHERE st.`song_id` = `songs`.`id`
      AND st.`lang` = COALESCE(NULLIF(TRIM(`songs`.`lyrics_translation_lang`), ''), 'zh-CN')
  );
