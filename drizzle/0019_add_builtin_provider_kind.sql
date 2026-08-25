-- Add a `kind` column to distinguish builtin sources from HTTP plugins, and
-- make `base_url` nullable (builtin providers have no external URL).
--
-- Also seeds the four builtin sources (LRCLIB / PetitLyrics / Uta-Net /
-- YouTube Music) as manageable rows with stable ids and priorities 0-3 so they
-- sit ahead of any pre-existing HTTP plugin configs. INSERT OR IGNORE keeps the
-- migration idempotent for both libsql and D1 runtimes.
ALTER TABLE `lyrics_provider_configs` ADD `kind` text DEFAULT 'http' NOT NULL;--> statement-breakpoint
-- Allow base_url to be null for builtin providers (they have no external URL).
ALTER TABLE `lyrics_provider_configs` RENAME COLUMN `base_url` TO `base_url_old`;--> statement-breakpoint
ALTER TABLE `lyrics_provider_configs` ADD `base_url` text;--> statement-breakpoint
UPDATE `lyrics_provider_configs` SET `base_url` = `base_url_old`;--> statement-breakpoint
ALTER TABLE `lyrics_provider_configs` DROP COLUMN `base_url_old`;--> statement-breakpoint
INSERT INTO lyrics_provider_configs (id, name, base_url, auth_type, enabled, priority, protocol_version, kind)
SELECT 'builtin:lrclib', 'LRCLIB', NULL, 'none', 1, 0, 1, 'builtin'
WHERE NOT EXISTS (SELECT 1 FROM lyrics_provider_configs WHERE id = 'builtin:lrclib');--> statement-breakpoint
INSERT INTO lyrics_provider_configs (id, name, base_url, auth_type, enabled, priority, protocol_version, kind)
SELECT 'builtin:petitlyrics', 'PetitLyrics', NULL, 'none', 1, 1, 1, 'builtin'
WHERE NOT EXISTS (SELECT 1 FROM lyrics_provider_configs WHERE id = 'builtin:petitlyrics');--> statement-breakpoint
INSERT INTO lyrics_provider_configs (id, name, base_url, auth_type, enabled, priority, protocol_version, kind)
SELECT 'builtin:uta-net', 'Uta-Net', NULL, 'none', 1, 2, 1, 'builtin'
WHERE NOT EXISTS (SELECT 1 FROM lyrics_provider_configs WHERE id = 'builtin:uta-net');--> statement-breakpoint
INSERT INTO lyrics_provider_configs (id, name, base_url, auth_type, enabled, priority, protocol_version, kind)
SELECT 'builtin:ytmusic', 'YouTube Music', NULL, 'none', 1, 3, 1, 'builtin'
WHERE NOT EXISTS (SELECT 1 FROM lyrics_provider_configs WHERE id = 'builtin:ytmusic');