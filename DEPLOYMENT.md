# Deployment Guide

Three deployment targets. The included Docker Compose file is tailored to an
existing Traefik installation, not a standalone localhost demo. For a quick
local trial without that infrastructure, follow the Node.js steps in
[README.md](README.md#local-quick-start).

| | Docker (self-hosted) | Cloudflare Workers (D1) | Vercel (Turso) |
|---|---|---|---|
| Database | Local SQLite file | Cloudflare D1 (built-in) | Turso (remote) |
| Furigana | Client-side (CDN) | Client-side (CDN) | Client-side (CDN) |
| Spotify poll | `server` or `client` | `client` only | `client` only |
| Cover storage | SQLite BLOB (automatic) | R2 object storage (optional, automatic fallback to BLOB) | SQLite BLOB (automatic) |
| Filesystem | ✅ Required | ❌ Not available | ❌ Not available |
| Node.js runtime | ✅ Required | ❌ Workers runtime | ✅ Node.js routes supported |

---

## 1. Docker (Self-Hosted)

For hosts already using Traefik. The app stores data in a local SQLite volume;
no external database is needed.

### Prerequisites for the included `docker-compose.yml`

- Docker + Docker Compose, plus an **already running Traefik** installation with
  the external network named by `TRAEFIK_NETWORK` (default in `.env.example`:
  `traefik_traefik-net`). The Compose file does not create the network or
  publish a host port.
- An existing Traefik auth middleware named by `TRAEFIK_AUTH_MIDDLEWARE`.
  Change the sample value to your own middleware; it is not bundled with this
  repository. Set a domain, TLS entrypoint and cert resolver that work in your
  own Traefik installation.
- A regular host **file** at
  `/data0/docker/jplrc-secrets/yt-music-oauth.json`, because the bundled
  `yt-sidecar` mounts that absolute path read-only. An empty file enables the
  unauthenticated fallback; for reliable YouTube Music searches configure an
  authenticated session as described in [yt-sidecar/README.md](yt-sidecar/README.md).
- A Spotify Developer App if you want to sign in, create/manage songs, use
  playback sync or import playlists. Anonymous users can only read public
  songs; a fresh database contains none.

### Steps

```bash
git clone https://cnb.cool/siubeng/jp-lyrics-app.git
cd jp-lyrics-app
cp .env.example .env
```

Edit `.env` for your installation. In particular, replace the sample domain,
network and middleware values, and set a dedicated `SESSION_SECRET` in
production. The relevant Compose interpolation values are:

```dotenv
JPLRC_DOMAIN=jplrc.example.com
JPLRC_PORT=3000
TRAEFIK_NETWORK=traefik_traefik-net
TRAEFIK_ENTRYPOINT=websecure
TRAEFIK_CERTRESOLVER=letsencrypt
TRAEFIK_AUTH_MIDDLEWARE=your-auth@docker
```

Check that your external network exists, and create the sidecar's host file
*only if it does not already exist* (never overwrite an authenticated session):

```bash
# Match the name to TRAEFIK_NETWORK in your .env
docker network inspect traefik_traefik-net
sudo mkdir -p /data0/docker/jplrc-secrets
test -f /data0/docker/jplrc-secrets/yt-music-oauth.json || \
  sudo touch /data0/docker/jplrc-secrets/yt-music-oauth.json
```

Optional application settings in `.env`:

```bash
# Spotify OAuth: required to log in, optional for anonymous public reading
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
# NOTE: this Compose file explicitly overrides BOTH switches to true for its
# bundled HTTP yt-sidecar on the private Docker network. These false values are
# the fail-closed defaults for deployments that do not use that Compose file;
# changing .env alone does NOT override Compose's true values.
LYRICS_PROVIDER_ALLOW_HTTP=false
LYRICS_PROVIDER_ALLOW_PRIVATE_NETWORK=false
# Required to store Bearer-token providers (AES-GCM encryption at rest).
LYRICS_PROVIDER_SECRET_KEY=

# yt-sidecar: authenticated upstream session (recommended — unauthenticated
# sessions get soft-throttled with empty results). Generate with
# `ytmusicapi oauth` / `ytmusicapi browser`, drop the file at
# /data0/docker/jplrc-secrets/yt-music-oauth.json (mounted read-only at
# /app/oauth.json). An empty/invalid file falls back to unauth.
# To notice a dead/soft-throttled session, probe `http://yt-sidecar:8910/health?deep=1`
# from inside the compose network — it runs one real upstream search, caches the
# answer for 60s, and returns 503 within a minute of the upstream going quiet.
# Optional request budget (see yt-sidecar/README.md, ISSUE #353). Keep the
# deadline below LYRICS_PROVIDER_DEFAULT_TIMEOUT_MS so a stalled upstream
# surfaces as the sidecar's own 503 instead of jplrc's client-side timeout.
# YT_MUSIC_DEADLINE_SECONDS=12
# YT_MUSIC_TIMEOUT_SECONDS=30
# Optional per-provider / chain budgets (ms). Missing/invalid values fall back to safe defaults.
LYRICS_PROVIDER_DEFAULT_TIMEOUT_MS=20000
LYRICS_PROVIDER_MAX_TIMEOUT_MS=60000
LYRICS_PROVIDER_MANIFEST_TIMEOUT_MS=15000
LYRICS_PROVIDER_CHAIN_TIMEOUT_MS=180000
```

Validate the Compose configuration and start both the app and sidecar:

```bash
docker compose config --quiet
docker compose up -d --build
```

Access the site through the configured Traefik domain; there is **no**
`localhost:3000` host port in this Compose file. Node/local SQLite and Turso
use the checked-in `drizzle/` journal and SQL migrations when the database
module loads (including the first request); you do not need to run a manual
schema-creation command on a new local database. Back up an existing database
before upgrading. Cloudflare D1 follows a **different manual migration path**
described below.

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
wrangler d1 create jp-lyrics-app

# Note the database_id and update the existing wrangler.jsonc DB binding
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

For a **new, empty** D1 database, use Drizzle Kit's D1 HTTP driver to push
the current schema. `drizzle.config.ts` otherwise defaults to the *local*
`data/local.db` file; running `npx drizzle-kit push` without the D1 driver
would initialize the wrong database. Supply the Cloudflare account ID, the
database ID returned by `wrangler d1 create`, and an API token as environment
variables (do not commit them):

```bash
DB_DRIVER=d1-http npx drizzle-kit push
# Requires CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_DATABASE_ID,
# and CLOUDFLARE_API_TOKEN in the environment.
```

Schema push does **not** run the data inserts from historical migrations, so a
new D1 database otherwise has **no built-in lyrics sources** and cannot find
lyrics. Seed the three current built-in providers on that remote database:

```bash
wrangler d1 execute jp-lyrics-app --remote --file=./scripts/seed-d1-builtin-providers.sql
```

The seed is idempotent and leaves existing rows untouched. It does not seed
the YouTube Music sidecar: that is an optional HTTP plugin unavailable on
Workers by default. Verify the provider rows in the admin System panel after
the first login. **Do not** run the entire historical `0019` migration on a
schema already created by `drizzle-kit push` — it would repeat schema changes.

This initializes the current schema and built-in providers, **not**
historical songs. Migrating data
from an existing local database needs a reviewed export/import plan; do not
blindly import a full SQLite `.dump` into a database whose schema was already
created. For subsequent releases, apply reviewed **pending** `drizzle/*.sql`
changes to the correct remote D1 database in journal order before deploying
the Worker; D1 does not run the Node startup migrator. Back up production D1
before a schema change and do not replay migrations already incorporated by
the fresh schema push.

### Step 3: Configure Wrangler

**Edit the existing [`wrangler.jsonc`](wrangler.jsonc), do not replace it with a
minimal example.** It already declares the `DB` D1 binding, `AI` Workers AI
binding, both R2 buckets, the OpenNext cache and the worker self-reference.
Set the D1 `database_id`/`database_name` to the database you provisioned;
if you rename the Worker, update its self-reference service name too. Check
that the R2 bucket names match those created above. Set
`SPOTIFY_POLL_MODE=client` in `vars`, configure the public HTTPS
`SPOTIFY_REDIRECT_URI`, and keep the existing `TRANSLATION_PROVIDER=workers-ai`
if you want translation without an external LLM key. Do not put credentials in
`vars` or commit them.

Set secrets interactively (the latter two only if used):

```bash
wrangler secret put SPOTIFY_CLIENT_ID
wrangler secret put SPOTIFY_CLIENT_SECRET
wrangler secret put SESSION_SECRET
# For an external OpenAI-compatible / Anthropic translation provider only:
# wrangler secret put TRANSLATION_API_KEY
# For Bearer-token HTTP lyrics providers only:
# wrangler secret put LYRICS_PROVIDER_SECRET_KEY
```

#### YouTube Music source (yt-sidecar) on Cloudflare

The bundled `yt-sidecar` service cannot run on Workers. **Existing databases**
that ran migration 0021 may have a seeded `ytmusic-sidecar` provider row at
`http://yt-sidecar:8910`, which is unreachable here; the network policy rejects
it before any call. A **new D1 database initialized with schema push alone**
has no seeded row; add an external provider only if you need one:

- **Disable or delete** the `ytmusic-sidecar` row in the admin 系统 → 歌词源
  panel, unless you point it at an external sidecar.
- To actually use YouTube Music: deploy `yt-sidecar/` on any host with public
  HTTPS and `PROVIDER_TOKEN` bearer auth, then set the row's base URL to it
  (`auth_type: bearer`, secret = the same token) — see `yt-sidecar/README.md`.
  The default network policy accepts public HTTPS; no `LYRICS_PROVIDER_ALLOW_*`
  change is needed.
- Do NOT set `LYRICS_PROVIDER_ALLOW_HTTP` /
  `LYRICS_PROVIDER_ALLOW_PRIVATE_NETWORK` on Cloudflare: nothing here needs
  them and they relax the SSRF policy globally.
- Remove a stale `YT_MUSIC_SIDECAR_URL` var if one exists — nothing reads it
  since migration 0021.

> **Note:** when using the `workers-ai` translation provider, no API key is
> needed — the checked-in `wrangler.jsonc` already declares an `AI` binding
> and `TRANSLATION_PROVIDER=workers-ai` by default.

### Step 4: Build & Deploy

```bash
# Build — this runs next build internally and outputs to .open-next/
npx @opennextjs/cloudflare build

# Verify output exists
ls .open-next/worker.js  # must exist before deploy

# For an existing D1 database only, apply each reviewed pending migration
# to the REMOTE database in journal order before deploy (example filename).
# wrangler d1 execute jp-lyrics-app --remote --file=./drizzle/NNNN_name.sql

# Deploy
wrangler deploy
```

### Important Notes

- **`SPOTIFY_POLL_MODE=client` is mandatory** — Workers have no persistent process for the server-side poller
- **D1 binding (`DB`)** is read by `getDB()` from the OpenNext Cloudflare request context; the app does not use `process.env.DB` or pass an argument to `getDB()`.
- **Run reviewed pending `drizzle/NNNN_*.sql` changes against the correct remote D1 before `wrangler deploy`**; D1 skips the Node startup migrator. A fresh DB initialized via schema push has already incorporated existing migrations — do not replay them.
- **Turso variables are not needed for D1** — the D1 binding is configured in `wrangler.jsonc` and resolved inside `src/lib/db.ts`.
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

Create a **Turso/libSQL** database in the Turso dashboard, obtain its URL and
an auth token, then set `TURSO_URL` and `TURSO_AUTH_TOKEN` in Vercel (Step 2).
Do not use the Cloudflare D1 / Wrangler setup steps for Turso. The Node
database module applies checked-in Drizzle migrations on initial load; back
up an existing Turso database before upgrading.

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
- **Runtime**: Do not assume every API route runs on the Edge Runtime. This is a Next.js app with Node.js routes (for example, `spotify/now-playing/stream` explicitly sets `runtime = 'nodejs'`).
- **`SPOTIFY_POLL_MODE=client` is mandatory** — Vercel serverless functions cannot host the persistent `spotify-poller.ts` singleton.

### Custom Domain

In Vercel dashboard → **Settings → Domains**, add your custom domain and configure DNS.

---

## Database Schema and Migrations

[`src/lib/schema.ts`](src/lib/schema.ts) defines the current tables and columns;
[`drizzle/meta/_journal.json`](drizzle/meta/_journal.json) lists the ordered
SQL migration files in [`drizzle/`](drizzle/). Do not rely on a hand-copied
table/column list or run ad-hoc `ALTER TABLE` statements from an old guide.

- **Docker / Node / Turso:** `src/lib/db.ts` checks the migration journal and
  applies pending SQL files inside a write transaction when the module loads.
  A fresh database is initialized by those migrations; an existing database
  must be backed up before a release. There is no need to manually replay
  migration SQL for these backends.
- **Cloudflare D1:** the Node startup migrator is skipped. Push the current
  schema only for a **fresh empty** D1 (Step 2 above); for later upgrades,
  back up D1 and apply reviewed, unapplied SQL changes to the correct remote
  database before deploying the Worker. Do not replay old migrations against
  a database initialized with the latest schema.

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
- The **code defaults** (both `false`) only allow **HTTPS + public addresses**.
  The included Docker Compose file intentionally **overrides both flags to
  `true`** to reach its bundled HTTP sidecar on a private network. This relaxes
  the transport and private-address policy for *all configured HTTP plugins*,
  not just the sidecar. Only enable trusted admin-configured plugins on that
  deployment; setting the flags to `false` in `.env` alone will not undo the
  Compose override. For a stricter deployment, change/override the Compose
  `jplrc.environment` values and use an HTTPS/public-address provider instead.
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
- **Cloudflare Workers (D1)**: optionally set budgets/policy in
  `wrangler.jsonc` `vars` and, only for Bearer providers, store
  `LYRICS_PROVIDER_SECRET_KEY` via Wrangler secrets. A **fresh D1 database**
  gets the provider table from schema push and requires the separate built-in
  seed in Step 2; do **not** replay migration 0018 on it. An **older D1
  database** lacking the table needs the reviewed pending migration(s) applied
  in journal order before upgrading, not an unconditional replay.

### Plugin protocol & example

See `examples/provider-plugin/README.md` for the HTTP provider protocol v1
contract, and `examples/provider-plugin/` for a runnable reference plugin
(Node).

