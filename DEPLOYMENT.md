# Deployment Guide

Three deployment targets with increasing levels of edge-readiness:

| | Docker (self-hosted) | Cloudflare Workers (D1) | Vercel (Turso) |
|---|---|---|---|
| Database | Local SQLite file | Cloudflare D1 (built-in) | Turso (remote) |
| Furigana | Client-side (CDN) | Client-side (CDN) | Client-side (CDN) |
| Spotify poll | `server` or `client` | `client` only | `client` only |
| Cover storage | SQLite BLOB (automatic) | R2 object storage (optional, automatic fallback to BLOB) | SQLite BLOB (automatic) |
| Filesystem | ✅ Required | ❌ Not available | ❌ Not available |
| Node.js runtime | ✅ Required | ❌ Edge only | ⚡ Edge or Node |

---

## 1. Docker (Self-Hosted)

The simplest path. Local SQLite file, no external database needed.

### Prerequisites

- Docker + Docker Compose
- (Optional) Traefik or other reverse proxy
- (Optional) Spotify Developer App

### Steps

```bash
git clone https://cnb.cool/siubeng/jp-lyrics-app.git
cd jp-lyrics-app
```

Create `.env`:

```bash
# Spotify (optional)
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_REDIRECT_URI=https://your-domain.com/api/auth/callback

# Poll mode — "server" uses Node.js singleton poller + SSE, "client" polls from browser
SPOTIFY_POLL_MODE=server

# Lyric translation (optional) — any OpenAI- or Anthropic-compatible LLM API.
# Provider defaults to OpenAI-compatible; set anthropic for the Messages API.
# If TRANSLATION_API_KEY is unset, DEEPSEEK_API_KEY is used as a fallback.
TRANSLATION_PROVIDER=openai
TRANSLATION_BASE_URL=https://api.deepseek.com/v1
TRANSLATION_API_KEY=your_api_key
TRANSLATION_MODEL=deepseek-v4-flash
TRANSLATION_TARGET_LANG=zh-CN
# Optional: daily translation quota in tokens; over-limit → 429 ai_quota_exceeded
AI_DAILY_NEURON_LIMIT=9000

# Optional: require a passphrase before starting Spotify OAuth (server-side only)
JPLRC_LOGIN_PASSPHRASE_REQUIRED=false
JPLRC_LOGIN_PASSPHRASE=your_passphrase

# Recommended in production: signs login/session cookies independently
SESSION_SECRET=your_session_secret

# HTTP lyrics providers (ISSUE #148) — deployment-level network policy + budgets.
# These are env-only; admins/users cannot override them from the UI or database.
# Boolean values accept only an explicit `true` (any other value = false / fail-closed).
LYRICS_PROVIDER_ALLOW_HTTP=false
LYRICS_PROVIDER_ALLOW_PRIVATE_NETWORK=false
# Required to store Bearer-token providers (AES-GCM encryption at rest).
LYRICS_PROVIDER_SECRET_KEY=
# Optional per-provider / chain budgets (ms). Missing/invalid values fall back to safe defaults.
LYRICS_PROVIDER_DEFAULT_TIMEOUT_MS=20000
LYRICS_PROVIDER_MAX_TIMEOUT_MS=60000
LYRICS_PROVIDER_MANIFEST_TIMEOUT_MS=15000
LYRICS_PROVIDER_CHAIN_TIMEOUT_MS=180000
```

Start:

```bash
docker compose up -d --build
```

The database (`data/local.db`) is automatically created on first run via `CREATE TABLE IF NOT EXISTS`. No migrations or seed files needed.

### Data Persistence

The `docker-compose.yml` mounts a named volume at `/app/data`:

```yaml
volumes:
  jplrc-data:
services:
  jplrc:
    volumes:
      - jplrc-data:/app/data
```

To back up the database:

```bash
docker cp jplrc:/app/data/local.db ./backup-local.db
```

### Reverse Proxy (Traefik)

The included `docker-compose.yml` has Traefik labels. Adjust the domain and network for your setup:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.jplrc.rule=Host(`jplrc.your-domain.com`)"
  - "traefik.http.services.jplrc.loadbalancer.server.port=3000"
```

### Spotify Poll Mode: `server` vs `client`

| | `server` | `client` |
|---|---|---|
| How it works | Node.js singleton polls Spotify every 2s, pushes diffs via SSE | Browser fetches `/api/spotify/now-playing` every 3s |
| Pros | Lower client bandwidth, instant updates | No server-side state, edge-compatible |
| Cons | Requires persistent Node.js process | Slightly higher latency, more client requests |
| Best for | Docker / VPS | Cloudflare / Vercel |

For Docker, `server` mode is recommended. Set `SPOTIFY_POLL_MODE=server`.

---

## 2. Cloudflare Workers + D1

Edge-deployed, globally distributed. Uses Cloudflare D1 (built-in SQLite).

### Prerequisites

- Cloudflare account with Workers enabled
- D1 database (free tier: 5M reads/day, 100K writes/day)
- Spotify Developer App
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)

### Step 1: Create D1 Database

```bash
# Create D1 database via Wrangler
wrangler d1 create jplrc-db

# Note the database_id from the output, then add to wrangler.toml
```

### Step 1b: Create R2 Buckets (album covers + OpenNext cache)

Album cover artwork is stored in **R2 object storage** (no D1 row-size
limits, no BLOB bloat). R2 is wired up via **bindings, not environment
variables** — the `COVER_R2_BUCKET` and `NEXT_INC_CACHE_R2_BUCKET`
bindings are already declared in `wrangler.jsonc`; you only need to create
the buckets once:

```bash
wrangler r2 bucket create jp-lyrics-app-covers          # album covers
wrangler r2 bucket create jp-lyrics-app-opennext-cache  # incremental cache
```

How cover storage behaves:

- **Cloudflare Workers** — covers are stored as R2 objects under the key
  `covers/<songId>` (content type kept in HTTP metadata). When a cover is
  replaced or a song deleted, the old object is removed too (double-delete).
  Uploads are capped at **1.5 MB**.
- **Docker / Vercel (no R2 binding)** — the same code path automatically
  falls back to a BLOB column in the `song_covers` table. No configuration
  needed.

> Note: if you rename a bucket, update `bucket_name` in `wrangler.jsonc` —
> the binding name `COVER_R2_BUCKET` must stay as-is (it is referenced in
> `src/lib/cover-store.ts`).

### Step 2: Set Up Schema

Apply the schema to D1:

```bash
# Using Drizzle Kit (recommended)
npx drizzle-kit push

# Or using Wrangler directly
wrangler d1 execute jplrc-db --file=./schema.sql
```

To migrate existing local data:
```bash
# Export from local SQLite
sqlite3 data/local.db .dump > dump.sql
# Import into D1
wrangler d1 execute jplrc-db --file=./dump.sql
```

### Step 3: Configure Wrangler

Create `wrangler.jsonc` (not `.toml` — OpenNext uses JSONC format):

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "main": ".open-next/worker.js",
  "name": "jplrc",
  "compatibility_date": "2025-01-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": ".open-next/assets",
    "binding": "ASSETS"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "jplrc-db",
      "database_id": "<your-database-id>"
    }
  ],
  "vars": {
    "SPOTIFY_POLL_MODE": "client",
    "SPOTIFY_REDIRECT_URI": "https://jplrc.your-domain.com/api/auth/callback",
    "TRANSLATION_PROVIDER": "openai",
    "TRANSLATION_BASE_URL": "https://api.deepseek.com/v1",
    "TRANSLATION_MODEL": "deepseek-v4-flash",
    "TRANSLATION_TARGET_LANG": "zh-CN",
    "AI_DAILY_NEURON_LIMIT": "9000",
    "LYRICS_PROVIDER_ALLOW_HTTP": "false",
    "LYRICS_PROVIDER_ALLOW_PRIVATE_NETWORK": "false",
    "LYRICS_PROVIDER_DEFAULT_TIMEOUT_MS": "20000",
    "LYRICS_PROVIDER_MAX_TIMEOUT_MS": "60000",
    "LYRICS_PROVIDER_MANIFEST_TIMEOUT_MS": "15000",
    "LYRICS_PROVIDER_CHAIN_TIMEOUT_MS": "180000"
  }
}
```

Set secrets:

```bash
wrangler secret put SPOTIFY_CLIENT_ID
wrangler secret put SPOTIFY_CLIENT_SECRET
wrangler secret put SESSION_SECRET   # optional, falls back to SPOTIFY_CLIENT_SECRET
wrangler secret put TRANSLATION_API_KEY   # optional, for the translation feature
# Required only if you configure Bearer-token HTTP lyrics providers (ISSUE #148)
wrangler secret put LYRICS_PROVIDER_SECRET_KEY
```

> **Note:** when using the `workers-ai` translation provider, no API key is
> needed — add the `ai` binding in `wrangler.jsonc` instead and set
> `TRANSLATION_PROVIDER=workers-ai`.

### Step 4: Build & Deploy

```bash
# Install OpenNext Cloudflare adapter (one-time)
npm install -D @opennextjs/cloudflare

# Build — this runs next build internally and outputs to .open-next/
npx @opennextjs/cloudflare build

# Verify output exists
ls .open-next/worker.js  # must exist before deploy

# Apply release migrations before sending traffic to the new Worker.
# D1 intentionally does not run the Node/local startup migrator.
wrangler d1 execute jplrc-db --remote --file=./drizzle/0004_lovely_doctor_faustus.sql
wrangler d1 execute jplrc-db --remote --file=./drizzle/0014_add_playlist_import_jobs.sql
wrangler d1 execute jplrc-db --remote --file=./drizzle/0018_add_lyrics_provider_configs.sql

# Deploy
wrangler deploy
```

### Important Notes

- **`SPOTIFY_POLL_MODE=client` is mandatory** — Workers have no persistent process for the server-side poller
- **D1 binding (`DB`)** is automatically available via `process.env.DB` in the OpenNext adapter
- **Run every new `drizzle/NNNN_*.sql` against D1 before `wrangler deploy`**; D1 skips the local startup migrator by design
- **`getDB(env.DB)`** in route handlers receives the D1 binding — no TURSO_URL needed
- Furigana is computed client-side via CDN-loaded kuromoji-es (no server dependency)
- The SSE stream endpoint returns `501` in client mode (by design)

### Limitations

- Spotify OAuth callback needs to reach the Worker — configure `SPOTIFY_REDIRECT_URI` accordingly
- The `spotify-poller.ts` singleton and `spotify.ts` token refresh logic are server-only and will be tree-shaken out of the Worker bundle
- Cron-based Spotify token refresh is not available (tokens refresh on-demand when the browser polls)
- D1 has a 10MB database size limit on the free tier (1GB on paid)

---

## 3. Vercel

Zero-config deploys from GitHub. Requires Turso for the database.

### Prerequisites

- Vercel account (free tier works)
- Turso account
- Spotify Developer App

### Step 1: Set Up Turso

Same as Cloudflare Step 1 above.

### Step 2: Configure Vercel Project

In the Vercel dashboard, go to **Settings → Environment Variables** and add:

| Variable | Value |
|---|---|
| `TURSO_URL` | `libsql://your-db.turso.io` |
| `TURSO_AUTH_TOKEN` | Your Turso token |
| `SPOTIFY_CLIENT_ID` | Your Spotify client ID |
| `SPOTIFY_CLIENT_SECRET` | Your Spotify client secret |
| `SPOTIFY_REDIRECT_URI` | `https://your-app.vercel.app/api/auth/callback` |
| `SPOTIFY_POLL_MODE` | `client` |
| `SESSION_SECRET` | Cookie signing key (optional, defaults to `SPOTIFY_CLIENT_SECRET`) |

### Step 3: Deploy

```bash
# Install Vercel CLI (optional)
npm i -g vercel

# Deploy
vercel

# Or connect GitHub repo in Vercel dashboard for auto-deploy on push
```

### Important Notes

- **`output: 'standalone'`** is set in `next.config.ts` — Vercel handles this automatically
- **Edge Runtime**: All API routes run on Vercel's Edge Runtime by default. If you need Node.js runtime for specific routes (e.g., `spotify/now-playing/stream`), add `export const runtime = 'nodejs'` to that route
- **`SPOTIFY_POLL_MODE=client` is mandatory** — Vercel serverless functions are stateless
- The `spotify-poller.ts` singleton won't work (no persistent process)

### Custom Domain

In Vercel dashboard → **Settings → Domains**, add your custom domain and configure DNS.

---

## Database Schema

The schema is self-initializing — tables are created automatically on first request via `CREATE TABLE IF NOT EXISTS`. No migration files or seed data needed.

```sql
songs           — id, title, artist, lyrics_raw, lyrics_furigana, lyrics_synced,
                  created_by, created_by_name, created_at, updated_at
spotify_auth    — user_email, access_token, refresh_token, expires_at,
                  display_name, updated_at
favorites       — user_email, song_id, created_at
collections     — id, user_email, name, created_at
collection_songs— collection_id, song_id, sort_order
lyrics_provider_configs — admin-configured global HTTP lyrics providers (ISSUE #148)
                  id, name, base_url, auth_type, auth_secret_ciphertext, enabled,
                  priority, timeout_ms, protocol_version, manifest_json,
                  last_check_status/code/latency_ms, checked_at, created_at, updated_at
```

### Manual Schema Migration

New columns are added via `ALTER TABLE ... ADD COLUMN` in `src/lib/db.ts`. These are idempotent (catch errors if column already exists). If you need to run them manually:

```sql
ALTER TABLE songs ADD COLUMN lyrics_synced TEXT NOT NULL DEFAULT '';
ALTER TABLE songs ADD COLUMN created_by TEXT NOT NULL DEFAULT '';
ALTER TABLE songs ADD COLUMN created_by_name TEXT NOT NULL DEFAULT '';
```

---

## Troubleshooting

### "SSE disabled — client polls directly"

Normal in `client` mode. The browser polls `/api/spotify/now-playing` instead of using SSE. Set `SPOTIFY_POLL_MODE=server` if you want SSE on Docker.

### Furigana not appearing

The kuromoji-es dictionary (~17MB gzipped) loads from CDN on first song view. Check browser console for CDN errors. If blocked by CSP, self-host the dictionary in `public/`.

### Turso connection errors

Ensure `TURSO_URL` format is `libsql://your-db.turso.io` (not `https://`). The `@libsql/client` uses the `libsql://` protocol.

### Docker container permission errors

The container runs as `nextjs` user (uid 1001). The `data/` directory is created and chowned in the Dockerfile. If using a bind mount instead of a named volume, ensure the host directory is writable by uid 1001.

---

## 4. HTTP Lyrics Providers — Deployment Configuration (ISSUE #148)

Project `jplrc` can hot-plug external HTTP lyrics providers via a versioned
protocol (`GET {base_url}/manifest.json` + `POST {base_url}/v1/search`).
Administrators manage providers in the admin UI; deployment only needs to set
the network policy and budget knobs below. **These are deployment-level
environment variables — they cannot be overridden from the UI or the
database, and ordinary users cannot configure providers at all.**

### Network policy (fail-closed)

| Variable | Default | Meaning |
|---|---|---|
| `LYRICS_PROVIDER_ALLOW_HTTP` | `false` | Allow plaintext `http://` provider base URLs |
| `LYRICS_PROVIDER_ALLOW_PRIVATE_NETWORK` | `false` | Allow loopback / RFC1918 / link-local / CGNAT / IPv6 ULA / Docker-bridge addresses |

- Boolean variables only accept an explicit `true` (case-insensitive); a
  missing, empty or any other value is treated as `false` — the policy never
  fails open.
- Default (both `false`) only allows **HTTPS + public addresses**.
- Cloud metadata targets (e.g. `169.254.169.254`, `100.100.100.200`) are
  **always denied**, regardless of these flags. Redirects are never followed
  (`redirect: 'error'`).
- When HTTP is allowed, affected providers are marked `insecure_transport` and
  the admin UI shows an explicit risk warning.

### Secret storage

| Variable | Required | Meaning |
|---|---|---|
| `LYRICS_PROVIDER_SECRET_KEY` | only for Bearer providers | AES-GCM encryption key used to store Bearer tokens at rest |

- Without `LYRICS_PROVIDER_SECRET_KEY`, only `auth=none` providers can be
  saved; Bearer-token providers are rejected.
- Tokens are never echoed by the API, UI, logs or audit trail.

### Request budgets (ms)

| Variable | Default | Meaning |
|---|---|---|
| `LYRICS_PROVIDER_DEFAULT_TIMEOUT_MS` | `20000` | Per-provider `/v1/search` budget |
| `LYRICS_PROVIDER_MAX_TIMEOUT_MS` | `60000` | Ceiling for an admin per-config `timeout_ms` override (5–60s clamp) |
| `LYRICS_PROVIDER_MANIFEST_TIMEOUT_MS` | `15000` | Manifest / test-connection budget |
| `LYRICS_PROVIDER_CHAIN_TIMEOUT_MS` | `180000` | Whole effective provider chain budget |

- Missing/invalid/out-of-range values fall back to these safe defaults;
  `DEFAULT_TIMEOUT_MS` is clamped to `MAX_TIMEOUT_MS`.
- Built-in providers keep their original per-request timeouts (PetitLyrics 8s,
  LRCLIB 15s, Uta-Net 15s, ytmusic 20s) — they are not squeezed to the plugin
  default, so existing search behavior is unchanged.

### Per-target notes

- **Docker / Vercel**: set these as regular environment variables (see the
  `.env` example in the Docker section, or Vercel's Environment Variables).
  The `lyrics_provider_configs` table is created automatically on first run.
- **Cloudflare Workers (D1)**: add the budget/policy vars to `vars` in
  `wrangler.jsonc`, and store `LYRICS_PROVIDER_SECRET_KEY` via
  `wrangler secret put LYRICS_PROVIDER_SECRET_KEY`. **You must also run the
  new migration `drizzle/0018_add_lyrics_provider_configs.sql` against D1**
  (D1 does not run the local startup migrator) — see Step 4 above.

### Plugin protocol & example

See `examples/provider-plugin/README.md` for the HTTP provider protocol v1
contract, and `examples/provider-plugin/` for a runnable reference plugin
(Node).

