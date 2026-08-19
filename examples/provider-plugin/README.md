# HTTP Lyrics Provider Protocol v1

This document describes how to author a runtime hot-plugged lyrics provider for
**jp-lyrics-app** (see ISSUE #148). Plugins are plain HTTP endpoints — jplrc
never executes third-party code. A plugin only retrieves **candidates**; jplrc
owns scoring, LRC parsing, validation, caching, low-confidence review and
security policy.

## 1. Base URL

An admin configures the **absolute base URL of a concrete plugin instance**
(not just an Origin). Multiple instances can share one Origin, each with its own
manifest, auth, priority and health.

```
https://lyrics.example.com/providers/lrclib-proxy
https://lyrics.example.com/providers/private-catalog
https://lyrics.example.com/team-a/japanese-lyrics
```

Fixed endpoints are relative to the base path:

| Endpoint | Method | Purpose |
|---|---|---|
| `{base_url}/manifest.json` | `GET` | capability negotiation |
| `{base_url}/v1/search` | `POST` | retrieve lyric candidates |

The manifest **cannot** override the search URL; sub-endpoints always resolve
relative to the base path (a leading `/` would reset to the Origin root and is
forbidden). No `/.well-known` discovery is used in v1.

## 2. Manifest

```
GET {base_url}/manifest.json
Accept: application/json
```

```json
{
  "protocol": "jplrc-lyrics-provider",
  "protocol_version": 1,
  "id": "example-provider",
  "name": "Example Lyrics",
  "version": "1.2.0",
  "capabilities": ["search", "plain", "synced"],
  "limits": { "max_candidates": 10 }
}
```

- `protocol` and `protocol_version` must match exactly; unsupported versions are
  refused on enable.
- Unknown fields are ignored (forward compatible).

## 3. Search

```
POST {base_url}/v1/search
Content-Type: application/json
Accept: application/json
User-Agent: jp-lyrics-app/<version>
Authorization: Bearer <token>      # only when the instance is bearer-auth
```

```json
{
  "protocol_version": 1,
  "request_id": "uuid",
  "track": {
    "title": "曲名",
    "artists": ["歌手"],
    "album": "专辑",
    "duration_ms": 210000,
    "isrc": null,
    "spotify_track_id": null,
    "locale": "zh-CN"
  },
  "accept": ["synced", "plain"],
  "max_candidates": 10
}
```

Success:

```json
{
  "protocol_version": 1,
  "request_id": "uuid",
  "candidates": [
    {
      "candidate_id": "opaque-id",
      "title": "曲名",
      "artists": ["歌手"],
      "album": "专辑",
      "duration_ms": 210000,
      "plain_lyrics": "...",
      "synced_lyrics": "[00:01.00]...",
      "source_url": "https://provider.example/song/123"
    }
  ]
}
```

Rules:

- No matches → HTTP `200` + `"candidates": []` (not an error).
- Every candidate must carry at least `plain_lyrics` or `synced_lyrics`.
- jplrc accepts at most 20 candidates, 1 MiB per response, 200,000 chars per
  lyric field; violations are treated as `invalid_response`.
- `source_url` must be a safe `https:` link; rendered with `noopener noreferrer`.

## 4. Error semantics

| HTTP | Meaning |
|---|---|
| 200 + `[]` | normal no-match |
| 400 / 422 | `invalid_request` |
| 401 / 403 | `auth_failed` (token never leaked) |
| 408 / timeout | `timeout` |
| 429 | `rate_limited` (honours capped `Retry-After`) |
| 5xx | `temporary_unavailable` |
| non-JSON / protocol mismatch / over-limit | `invalid_response` |

Optional error body:

```json
{ "error": { "code": "rate_limited", "message": "...", "retry_after_ms": 3000 } }
```

The third-party `message` only feeds controlled/truncated admin diagnostics —
never user-facing text (users see language-neutral error codes mapped to i18n).

## 5. Auth

v1 supports `none` and `bearer` only. jplrc never sends session / Spotify / other
credentials to plugins. Bearer tokens are stored AES-GCM encrypted at rest and
never echoed in APIs, logs or audit.

## 6. Security

- Default policy: HTTPS + public addresses only.
- Deployers may set `LYRICS_PROVIDER_ALLOW_HTTP` and
  `LYRICS_PROVIDER_ALLOW_PRIVATE_NETWORK` (deployment env vars, not DB/UI
  settings). Cloud metadata targets are always forbidden; redirects are never
  followed.
- All requests are initiated by jplrc's server, never the browser.

## Example

A minimal Node reference implementation lives in
[`examples/provider-plugin/index.mjs`](provider-plugin/index.mjs):

```bash
node examples/provider-plugin/index.mjs --port 8787
```

Then in the admin 系统 → 歌词源 panel, add a provider with base URL
`http://localhost:8787` (requires `LYRICS_PROVIDER_ALLOW_HTTP=true` +
`LYRICS_PROVIDER_ALLOW_PRIVATE_NETWORK=true` for local testing).
