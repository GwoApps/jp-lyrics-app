-- Convert the builtin YouTube Music source (yt-sidecar) into a regular HTTP
-- provider plugin row speaking the jplrc-lyrics-provider v1 protocol
-- (examples/provider-plugin/README.md). The sidecar now serves
-- GET /manifest.json + POST /v1/search, so the app no longer needs a builtin
-- adapter for it and the row joins the same chain as every other plugin.
--
-- Row id: `ytmusic-sidecar` (stable, readable). base_url prefers the admin
-- `sidecar_url` override from source_config when one was configured; otherwise
-- it falls back to the compose-network default from this repo's docker-compose
-- (`http://yt-sidecar:8910`). Deployments with a custom sidecar URL must update
-- the row in the admin 歌词源 panel (or set source_config.sidecar_url first).
--
-- Note: because the sidecar runs over plaintext HTTP on the compose network,
-- the deployment must set LYRICS_PROVIDER_ALLOW_HTTP=true and
-- LYRICS_PROVIDER_ALLOW_PRIVATE_NETWORK=true (see DEPLOYMENT.md).
--
-- Both historical row-id spellings are handled: `builtin-ytmusic` (hyphen,
-- seeded by an earlier internal build on the live deployment) and
-- `builtin:ytmusic` (colon, seeded by migration 0019 on fresh databases).
INSERT INTO lyrics_provider_configs (id, name, base_url, auth_type, enabled, priority, timeout_ms, protocol_version, kind, source_config, last_check_status, created_at, updated_at)
SELECT 'ytmusic-sidecar', name,
  COALESCE(json_extract(source_config, '$.sidecar_url'), 'http://yt-sidecar:8910'),
  'none', enabled, priority, NULL, 1, 'http', NULL, 'unchecked', created_at, datetime('now', 'localtime')
FROM lyrics_provider_configs
WHERE id IN ('builtin-ytmusic', 'builtin:ytmusic')
  AND NOT EXISTS (SELECT 1 FROM lyrics_provider_configs WHERE id = 'ytmusic-sidecar');--> statement-breakpoint
DELETE FROM lyrics_provider_configs WHERE id IN ('builtin-ytmusic', 'builtin:ytmusic');
