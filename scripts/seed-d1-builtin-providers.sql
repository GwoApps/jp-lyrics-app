-- Initialize built-in lyrics providers after pushing the CURRENT schema to a
-- NEW, EMPTY Cloudflare D1 database. Schema-only drizzle-kit push does not
-- execute the data inserts from historical migration 0019.
--
-- Safe to rerun: existing rows (including disabled/admin-customized rows) are
-- left untouched. Do NOT apply migration 0019 itself to an already-current
-- schema: its ALTER TABLE statements would repeat schema changes.
-- YouTube Music is not inserted here because its current implementation is an
-- optional HTTP sidecar, unavailable on Cloudflare Workers by default.
INSERT INTO lyrics_provider_configs (id, name, base_url, auth_type, enabled, priority, protocol_version, kind)
SELECT 'builtin:lrclib', 'LRCLIB', NULL, 'none', 1, 0, 1, 'builtin'
WHERE NOT EXISTS (SELECT 1 FROM lyrics_provider_configs WHERE id = 'builtin:lrclib');

INSERT INTO lyrics_provider_configs (id, name, base_url, auth_type, enabled, priority, protocol_version, kind)
SELECT 'builtin:petitlyrics', 'PetitLyrics', NULL, 'none', 1, 1, 1, 'builtin'
WHERE NOT EXISTS (SELECT 1 FROM lyrics_provider_configs WHERE id = 'builtin:petitlyrics');

INSERT INTO lyrics_provider_configs (id, name, base_url, auth_type, enabled, priority, protocol_version, kind)
SELECT 'builtin:uta-net', 'Uta-Net', NULL, 'none', 1, 2, 1, 'builtin'
WHERE NOT EXISTS (SELECT 1 FROM lyrics_provider_configs WHERE id = 'builtin:uta-net');
