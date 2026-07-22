# 歌詞ノート (Kashi Note)

A Japanese lyrics management web app with furigana annotation, Spotify real-time sync, and PWA support.

[日本語](README-ja.md) | [中文](README-zh.md) | [Deployment Guide](DEPLOYMENT.md)

## Features

- **Furigana Lyrics** — Paste Japanese lyrics; client-side kuromoji-es auto-converts kanji to hiragana furigana via `<ruby>` annotations (lazy-loaded on first use)
- **Spotify Real-Time Sync** — OAuth-connected playback tracking with SSE streaming (server mode) or direct polling (client mode), line-by-line auto-scroll
- **Timeline Annotation Workspace** — Mark previously untimed lyrics line by line against live Spotify progress, save partial work, replay marked positions, undo, and apply global offsets
- **Reading Modes** — Switch between original lyrics, furigana, and Hepburn-style romaji; preference is remembered locally
- **Canonical Spotify Metadata** — Persist stable Track IDs, URI, album, duration, cover, and canonical title/artist for exact matching
- **Lyrics Provenance** — Track the selected provider, heuristic match confidence, and fetch timestamp
- **PiP (Picture-in-Picture)** — Floating lyrics window over other apps (desktop Chrome)
- **PWA** — Installable on Android/iOS with offline caching and update notifications
- **Dark / Light Theme** — System-aware with manual toggle, persisted via localStorage
- **Multi-Language UI** — Japanese, English, Simplified Chinese, Traditional Chinese (auto-detected from browser)
- **lrclib.net Sync** — Fetch timestamped lyrics for precise per-line synchronization
- **One-Click Import** — Import lyrics for the currently playing Spotify track instantly
- **Playlist Batch Import** — Import all tracks from a Spotify playlist at once
- **Favorites & Collections** — Star songs, organize into collections, filter by favorites
- **Export** — Download lyrics as plain text, LRC (timestamped), or HTML
- **Copy Lyrics** — Strip furigana, copy clean text to clipboard
- **Adjustable Font Size** — A−/A+ controls for comfortable reading
- **Responsive** — Mobile-optimized bottom bar with 3-dot overflow menu

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| UI | React 19, Tailwind CSS v4, Lucide Icons |
| Database | Drizzle ORM + @libsql/client (Turso, local SQLite, or Cloudflare D1) |
| Furigana Engine | kuromoji-es (browser CDN, lazy-loaded) |
| Lyrics Source | lrclib.net |
| Music Integration | Spotify Web API (OAuth 2.0) + SSE / client polling |
| Deployment | Docker (self-hosted), Cloudflare Workers, Vercel Edge |

## Quick Start

```bash
# Clone
git clone https://github.com/GwoApps/jp-lyrics-app.git
cd jp-lyrics-app

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your Spotify credentials (optional)

# Start dev server
npm run dev
# → http://localhost:3000
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SPOTIFY_CLIENT_ID` | No | Spotify app client ID |
| `SPOTIFY_CLIENT_SECRET` | No | Spotify app client secret |
| `SPOTIFY_REDIRECT_URI` | No | Override callback URL (default: request origin + `/api/auth/callback`) |
| `SPOTIFY_POLL_MODE` | No | `client` (default) or `server`. See [DEPLOYMENT.md](DEPLOYMENT.md) |
| `TURSO_URL` | No | Turso database URL (e.g. `libsql://xxx.turso.io`). Without this, falls back to local SQLite file. For CF D1, use binding instead |
| `TURSO_AUTH_TOKEN` | No | Turso auth token (required when `TURSO_URL` is set) |

Spotify integration is optional. Without it, you can still manage lyrics manually.

Create an app on the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and set the redirect URI to `http://localhost:3000/api/auth/callback`.

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed guides:

- **Docker** (self-hosted) — Local SQLite, Traefik reverse proxy
- **Cloudflare Workers** — Turso database, edge-compatible
- **Vercel** — Turso database, edge runtime

## Project Structure

```
src/
├── app/
│   ├── page.tsx                          # Song list with search, filters, now-playing
│   ├── layout.tsx                        # Root layout with PWA meta, SW registration
│   ├── globals.css                       # Theme variables, animations
│   ├── songs/
│   │   ├── new/page.tsx                  # Create song
│   │   ├── [id]/page.tsx                 # Lyrics detail (Spotify sync, PiP, debug)
│   │   └── [id]/edit/page.tsx            # Edit song
│   └── api/
│       ├── songs/                        # CRUD + search + favorites filter
│       ├── songs/import/                 # lrclib one-click import
│       ├── songs/import-playlist/        # Spotify playlist batch import
│       ├── songs/[id]/sync/              # Fetch synced lyrics
│       ├── songs/[id]/export/            # Export as txt/lrc/html
│       ├── songs/[id]/favorite/          # Toggle favorite
│       ├── collections/                  # Collection CRUD
│       ├── auth/                         # Spotify OAuth
│       ├── spotify/
│       │   ├── config/                   # Poll mode config for client
│       │   ├── now-playing/              # Current track (REST)
│       │   ├── now-playing/stream/       # SSE endpoint (server mode only)
│       │   └── status/                   # Connection status
│       └── me/                           # Current user
├── components/
│   ├── FuriganaLine.tsx                  # Ruby annotation renderer
│   ├── ConfirmDialog.tsx                 # Reusable modal dialog
│   ├── LanguageSwitcher.tsx              # Locale picker
│   └── AppShell.tsx                      # Theme + i18n providers
├── hooks/
│   ├── useNowPlaying.ts                  # SSE + polling dual mode
│   ├── useSpotifySync.ts                 # Playback state + lyrics sync
│   └── useSongData.ts                    # Song data + handlers
├── lib/
│   ├── db.ts                             # @libsql/client (Turso / local SQLite)
│   ├── schema.ts                         # Drizzle ORM typed schema definitions
│   ├── kuroshiro-client.ts               # Client-side furigana (CDN lazy-load)
│   ├── compound-readings.ts              # Compound reading corrections
│   ├── match.ts                          # Multi-level song matching
│   ├── lrc.ts                            # LRC parsing utilities
│   ├── spotify.ts                        # Spotify token management + base64 util
│   ├── spotify-poller.ts                 # Singleton poller (server mode only)
│   ├── auth.ts                           # Auth helpers
│   ├── theme.tsx                         # ThemeProvider + useTheme
│   ├── i18n.tsx                          # I18nProvider + useI18n
│   └── types.ts                          # Shared types
└── i18n/
    ├── ja.json                           # Japanese
    ├── en.json                           # English
    ├── zh-CN.json                        # Simplified Chinese
    └── zh-TW.json                        # Traditional Chinese
```

## API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/api/songs` | GET | List songs (`?q=`, `?mine=1`, `?favorites=1`) |
| `/api/songs` | POST | Create song |
| `/api/songs/import` | POST | Import from lrclib by title + artist |
| `/api/songs/import-playlist` | POST | Batch import from Spotify playlist |
| `/api/songs/[id]` | GET/PUT/DELETE | Single song CRUD |
| `/api/songs/[id]/sync` | POST | Fetch synced lyrics (lrclib) |
| `/api/songs/[id]/export` | GET | Export as `?format=txt\|lrc\|html` |
| `/api/songs/[id]/favorite` | POST | Toggle favorite |
| `/api/auth/login` | GET | Spotify OAuth login |
| `/api/auth/callback` | GET | Spotify OAuth callback |
| `/api/spotify/config` | GET | Poll mode config |
| `/api/spotify/now-playing` | GET | Current track (REST) |
| `/api/spotify/now-playing/stream` | GET | SSE now-playing (server mode only) |
| `/api/collections` | GET/POST | Collections CRUD |
| `/api/me` | GET | Current authenticated user |

## License

[MIT](LICENSE)
