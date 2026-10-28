# 歌詞ノート (Kashi Note)

A web reader for Japanese and Cantonese lyrics, with furigana/Jyutping, AI translation, Spotify-synced playback, and installable PWA support. **Within the app, guests can read public songs (a reverse proxy may impose additional access controls); creating, editing, importing, and translating songs requires Spotify OAuth login.** A new database has no songs until a signed-in user adds or imports them.

[Features](FEATURES.md) | [日本語](README-ja.md) | [中文](README-zh.md) | [Deployment Guide](DEPLOYMENT.md)

## Highlights

- Lyrics reading modes, per-line actions, synced follow-scroll, and a full-screen immersive lyrics view (browser full-screen where supported).
- Spotify playback sync, playlist import, timestamp editing, share cards, and picture-in-picture lyrics (browser support varies).
- Whole-song and per-line AI translation via OpenAI-compatible, Anthropic, or Cloudflare Workers AI. SSE reports stages and completion progress; the final `done` event contains the translated lines. Reasoning is displayed only when the provider supplies it.
- Configurable lyrics-source chain: built-in sources including LRCLIB and administrator-managed HTTP providers. The bundled [YouTube Music sidecar](yt-sidecar/README.md) is one provider-plugin example.
- Four UI languages (ja, en, zh-CN, zh-TW), favorites/collections, PWA, and dark/light themes.

See [FEATURES.md](FEATURES.md) for the walkthrough and [the provider protocol](examples/provider-plugin/README.md) for custom lyrics sources. Administrators configure global lyrics sources under **Admin → System → Lyrics Providers**.

## Tech Stack

| Layer | Technology |
|---|---|
| App | Next.js 16 (App Router), React 19, Tailwind CSS v4 |
| Database | Drizzle ORM + libSQL (local SQLite or Turso), or Cloudflare D1 |
| Lyrics | Built-in sources + versioned HTTP provider plugins; browser-loaded reading engine |
| Music / AI | Spotify Web API (OAuth 2.0); OpenAI-compatible, Anthropic, or Workers AI |
| Hosting | Docker (Node.js), Cloudflare Workers, or Vercel (client-side Spotify polling on serverless) |

## Local Quick Start

Use **Node.js 22** and npm. The lockfile is committed; use `npm ci` for a reproducible install.

```bash
git clone https://cnb.cool/siubeng/jp-lyrics-app.git
cd jp-lyrics-app
npm ci
cp .env.example .env
npm run dev
# http://localhost:3000
```

Spotify credentials are not needed to start the app or browse public songs, but **Spotify OAuth is the only application login**. To create/manage songs, add `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` to `.env`, create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), and register `http://localhost:3000/api/auth/callback` as its redirect URI. Playback sync and playlist import also need a Spotify connection. AI translation needs a configured provider; it is optional for basic reading/editing.

### Configuration at a glance

| Setting | Purpose |
|---|---|
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | OAuth login; required for signed-in features, not anonymous public reading |
| `SPOTIFY_REDIRECT_URI`, `SPOTIFY_POLL_MODE` | Override OAuth callback; playback mode `client` (default) or `server` (persistent Node server only) |
| `TURSO_URL`, `TURSO_AUTH_TOKEN` | Optional remote database; without a URL, Node uses `data/local.db`; Workers use a D1 binding |
| `TRANSLATION_PROVIDER` | `openai` (default), `anthropic`, or `workers-ai` (Cloudflare AI binding required) |
| `TRANSLATION_BASE_URL`, `TRANSLATION_API_KEY`, `TRANSLATION_MODEL`, `TRANSLATION_TARGET_LANG` | Provider endpoint/key/model/default target language; Workers AI needs no API key. The sample `.env` sets an OpenAI-compatible model: change or remove it when changing providers. |
| `AI_DAILY_NEURON_LIMIT` | Optional daily translation quota |
| `SESSION_SECRET`, `JPLRC_LOGIN_PASSPHRASE_REQUIRED`, `JPLRC_LOGIN_PASSPHRASE` | Set a dedicated session-signing secret in production; optional pre-OAuth passphrase gate |
| `LYRICS_PROVIDER_*` | Deployment-level network policy, Bearer-token encryption key, and request budgets for HTTP lyrics plugins; see [§4 of the deployment guide](DEPLOYMENT.md#4-http-lyrics-providers-deployment-configuration-issue-148) |

Admins can also set the **global translation provider/model** in the app. Non-empty admin-stored values override the environment; empty fields fall back to it. A signed-in user's target-language preference can override the global default. See [.env.example](.env.example) and [DEPLOYMENT.md](DEPLOYMENT.md) for details. Do not commit real credentials.

### Docker is a separate deployment path

The included `docker-compose.yml` is **not** a standalone localhost setup: it uses an existing external Traefik network and auth middleware, publishes no host port, and mounts a host file for the YouTube Music sidecar. Check those prerequisites (and customize `.env`) before `docker compose up -d --build`; see [Docker setup in DEPLOYMENT.md](DEPLOYMENT.md#1-docker-self-hosted). For a local trial without Traefik, use `npm run dev` above.

## Development

```bash
npm run check       # TypeScript, ESLint, i18n, tests
npm run check:full  # all checks plus a production build
```

Project map: [`src/app/`](src/app/) (pages and API routes), [`src/components/`](src/components/) (UI), [`src/hooks/`](src/hooks/) (client behavior), [`src/lib/`](src/lib/) (database, lyrics and translation), [`src/i18n/`](src/i18n/) (four locales), [`drizzle/`](drizzle/) (SQL migrations), and [`yt-sidecar/`](yt-sidecar/) (HTTP provider). For feature workflows see [FEATURES.md](FEATURES.md); for deployment and migration rules see [DEPLOYMENT.md](DEPLOYMENT.md).

## API orientation

- Song listings and public song details: [`src/app/api/songs/`](src/app/api/songs/) (`GET`); writes/imports need a Spotify-authenticated session.
- `POST /api/songs/[id]/translate`: with `stream: true`, SSE emits `stage` and `progress`, optional `reasoning` deltas, then `done` with translated lines, or `error`. Translation chunks are not sent as individual `translation` events. The endpoint supports whole-song and selected-line translation; see [route documentation](src/app/api/songs/%5Bid%5D/translate/route.ts).
- Admin-managed providers: [`src/app/api/admin/lyrics-providers/`](src/app/api/admin/lyrics-providers/) (admin-only). Plugin authors should use the [versioned HTTP protocol](examples/provider-plugin/README.md), not the admin API as a search endpoint.

The [API route tree](src/app/api/) is the source of truth for methods and request bodies; it is more reliable than a duplicated exhaustive endpoint list in this README.

## License

[MIT](LICENSE)
