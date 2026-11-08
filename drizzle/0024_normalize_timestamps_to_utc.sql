-- ISSUE #364 — normalise every stored timestamp onto an absolute UTC instant.
--
-- Until now columns defaulted to SQLite's `datetime('now', 'localtime')`, which
-- returns a bare `YYYY-MM-DD HH:MM:SS` wall clock carrying no timezone marker.
-- No supported deployment sets `TZ` (node:22-alpine runner, compose services,
-- Workers/D1), so `'localtime'` resolved to UTC while the browser parsed the
-- bare string as *its own* local time: a UTC+8 visitor saw every created/updated
-- time 8 hours early, and one row rendered differently in every time zone.
--
-- New writes go through `nowUtcSql()` (`strftime('%Y-%m-%dT%H:%M:%fZ','now')`),
-- byte-identical to `new Date().toISOString()`. This migration brings existing
-- rows to the same convention by reading the naive value as UTC — which is what
-- it actually was — and re-emitting it with an explicit `Z`.
--
-- Idempotent: a value is converted only when it still looks like a naive wall
-- clock, so re-running keeps ISO values (e.g. `lyrics_fetched_at`,
-- `checked_at`) and anything already carrying `Z` / `±HH:MM` untouched.
--
-- Column DEFAULTs are deliberately not rewritten: SQLite cannot ALTER them
-- without rebuilding every table, and they are not needed. Drizzle inlines the
-- `nowUtcSql()` default into every INSERT that omits the column, and the few
-- hand-written INSERTs in the codebase pass the timestamp explicitly. A raw
-- SQL INSERT outside the app would opt out of both — write the UTC expression
-- yourself if you ever add one.

UPDATE `songs` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', `created_at`)
WHERE `created_at` IS NOT NULL
  AND `created_at` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
  AND `created_at` NOT LIKE '%Z'
  AND `created_at` NOT GLOB '*[+-][0-9][0-9]:[0-9][0-9]*'
--> statement-breakpoint
UPDATE `songs` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', `updated_at`)
WHERE `updated_at` IS NOT NULL
  AND `updated_at` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
  AND `updated_at` NOT LIKE '%Z'
  AND `updated_at` NOT GLOB '*[+-][0-9][0-9]:[0-9][0-9]*'
--> statement-breakpoint
UPDATE `spotify_auth` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', `updated_at`)
WHERE `updated_at` IS NOT NULL
  AND `updated_at` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
  AND `updated_at` NOT LIKE '%Z'
  AND `updated_at` NOT GLOB '*[+-][0-9][0-9]:[0-9][0-9]*'
--> statement-breakpoint
UPDATE `favorites` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', `created_at`)
WHERE `created_at` IS NOT NULL
  AND `created_at` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
  AND `created_at` NOT LIKE '%Z'
  AND `created_at` NOT GLOB '*[+-][0-9][0-9]:[0-9][0-9]*'
--> statement-breakpoint
UPDATE `collections` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', `created_at`)
WHERE `created_at` IS NOT NULL
  AND `created_at` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
  AND `created_at` NOT LIKE '%Z'
  AND `created_at` NOT GLOB '*[+-][0-9][0-9]:[0-9][0-9]*'
--> statement-breakpoint
UPDATE `users` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', `created_at`)
WHERE `created_at` IS NOT NULL
  AND `created_at` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
  AND `created_at` NOT LIKE '%Z'
  AND `created_at` NOT GLOB '*[+-][0-9][0-9]:[0-9][0-9]*'
--> statement-breakpoint
UPDATE `users` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', `updated_at`)
WHERE `updated_at` IS NOT NULL
  AND `updated_at` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
  AND `updated_at` NOT LIKE '%Z'
  AND `updated_at` NOT GLOB '*[+-][0-9][0-9]:[0-9][0-9]*'
--> statement-breakpoint
UPDATE `lyrics_provider_configs` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', `created_at`)
WHERE `created_at` IS NOT NULL
  AND `created_at` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
  AND `created_at` NOT LIKE '%Z'
  AND `created_at` NOT GLOB '*[+-][0-9][0-9]:[0-9][0-9]*'
--> statement-breakpoint
UPDATE `lyrics_provider_configs` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', `updated_at`)
WHERE `updated_at` IS NOT NULL
  AND `updated_at` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
  AND `updated_at` NOT LIKE '%Z'
  AND `updated_at` NOT GLOB '*[+-][0-9][0-9]:[0-9][0-9]*'
--> statement-breakpoint
UPDATE `lyrics_provider_configs` SET `checked_at` = strftime('%Y-%m-%dT%H:%M:%fZ', `checked_at`)
WHERE `checked_at` IS NOT NULL
  AND `checked_at` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
  AND `checked_at` NOT LIKE '%Z'
  AND `checked_at` NOT GLOB '*[+-][0-9][0-9]:[0-9][0-9]*'
--> statement-breakpoint
UPDATE `user_settings` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', `updated_at`)
WHERE `updated_at` IS NOT NULL
  AND `updated_at` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
  AND `updated_at` NOT LIKE '%Z'
  AND `updated_at` NOT GLOB '*[+-][0-9][0-9]:[0-9][0-9]*'
--> statement-breakpoint
UPDATE `song_covers` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', `updated_at`)
WHERE `updated_at` IS NOT NULL
  AND `updated_at` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
  AND `updated_at` NOT LIKE '%Z'
  AND `updated_at` NOT GLOB '*[+-][0-9][0-9]:[0-9][0-9]*'
--> statement-breakpoint
UPDATE `playlist_import_jobs` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', `created_at`)
WHERE `created_at` IS NOT NULL
  AND `created_at` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
  AND `created_at` NOT LIKE '%Z'
  AND `created_at` NOT GLOB '*[+-][0-9][0-9]:[0-9][0-9]*'
--> statement-breakpoint
UPDATE `playlist_import_jobs` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', `updated_at`)
WHERE `updated_at` IS NOT NULL
  AND `updated_at` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
  AND `updated_at` NOT LIKE '%Z'
  AND `updated_at` NOT GLOB '*[+-][0-9][0-9]:[0-9][0-9]*'
--> statement-breakpoint
UPDATE `admin_audit_log` SET `occurred_at` = strftime('%Y-%m-%dT%H:%M:%fZ', `occurred_at`)
WHERE `occurred_at` IS NOT NULL
  AND `occurred_at` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
  AND `occurred_at` NOT LIKE '%Z'
  AND `occurred_at` NOT GLOB '*[+-][0-9][0-9]:[0-9][0-9]*'
--> statement-breakpoint
UPDATE `playlist_import_track_results` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', `created_at`)
WHERE `created_at` IS NOT NULL
  AND `created_at` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
  AND `created_at` NOT LIKE '%Z'
  AND `created_at` NOT GLOB '*[+-][0-9][0-9]:[0-9][0-9]*'
