# 歌詞ノート (Kashi Note)

A Japanese lyrics management web app with furigana annotation, AI translation, Spotify real-time sync, an experiments panel (mic spectrum on the lyrics dot grid), and PWA support.

[日本語](README-ja.md) | [中文](README-zh.md) | [Deployment Guide](DEPLOYMENT.md)

## Features

- **Furigana Lyrics** — Paste Japanese lyrics; client-side kuromoji-es auto-converts kanji to hiragana furigana via `<ruby>` annotations (lazy-loaded on first use)
- **AI Lyric Translation** — SSE-streamed translation into the target language with a live reasoning panel, terminology glossary extraction, retry + quota handling, and pluggable providers (OpenAI-compatible / Anthropic Messages / Cloudflare Workers AI)
- **Spotify Real-Time Sync** — OAuth-connected playback tracking with SSE streaming (server mode) or direct polling (client mode), line-by-line auto-scroll with Apple-style eased follow animation
- **Timeline Annotation Workspace** — Mark previously untimed lyrics line by line against live Spotify progress, save partial work, replay marked positions, undo, and apply global offsets
- **Lyrics Dot Grid** — Canvas dot-matrix background with a pointer spotlight; the **Experiments** panel adds a live microphone spectrum that lights the grid's bottom rows (Web Audio API, peak ≤ 1/3 of panel height)
- **Share Cards** — Generate a shareable canvas image (landscape/portrait, QR code, selectable lyric lines) and download as PNG
- **Admin Console** — `/admin` for admins: user management (promote/demote, block/unblock, delete), song visibility control, pending public-approval queue, and live translation-service configuration with connectivity test
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
| Translation | OpenAI-compatible / Anthropic / Workers AI (SSE streaming) |
| Audio (experiments) | Web Audio API (AnalyserNode, getUserMedia) |
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
# Edit .env with your Spotify credentials (optional) and translation API key (optional)

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
| `TRANSLATION_PROVIDER` | No | `openai` (default, OpenAI-compatible) or `anthropic` (Anthropic Messages API) |
| `TRANSLATION_BASE_URL` | No | OpenAI-compatible base URL (default `https://api.deepseek.com/v1`) |
| `TRANSLATION_API_KEY` | No | LLM API key (falls back to `DEEPSEEK_API_KEY`) |
| `TRANSLATION_MODEL` | No | Model name (default `deepseek-v4-flash`) |
| `TRANSLATION_TARGET_LANG` | No | Default target language for translation (default `zh-CN`) |
| `AI_DAILY_NEURON_LIMIT` | No | Daily translation quota (tokens); over-limit requests return `429 / ai_quota_exceeded` |
| `JPLRC_LOGIN_PASSPHRASE_REQUIRED` | No | Require a passphrase before starting Spotify OAuth |
| `JPLRC_LOGIN_PASSPHRASE` | No | The passphrase itself (validated server-side only) |
| `SESSION_SECRET` | No | Recommended in production: signs login/session cookies |

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
│   ├── page.tsx                          # Song list: search, filters, now-playing
│   ├── layout.tsx                        # Root layout with PWA meta, SW registration
│   ├── globals.css                       # Theme variables, animations
│   ├── admin/page.tsx                    # Admin console (users / songs / pending / translation)
│   ├── songs/
│   │   ├── new/page.tsx                  # Create song
│   │   └── [id]/
│   │       ├── page.tsx                  # Lyrics detail (Spotify sync, dot grid, menus, PiP)
│   │       ├── edit/page.tsx             # Edit song
│   │       ├── translation/page.tsx      # Full-song translation workspace
│   │       ├── share/page.tsx            # Share-card generator (drawing lives in lib/share-card.ts)
│   │       └── timeline/edit/page.tsx    # Timeline annotation workspace
│   └── api/
│       ├── songs/                        # CRUD + search + favorites filter
│       ├── songs/import/                 # lrclib one-click import
│       ├── songs/import-playlist/        # Spotify playlist batch import
│       ├── songs/[id]/sync/              # Fetch synced lyrics
│       ├── songs/[id]/export/            # Export as txt/lrc/html
│       ├── songs/[id]/favorite/          # Toggle favorite
│       ├── songs/[id]/translate/         # SSE translation stream (reasoning + result)
│       ├── collections/                  # Collection CRUD
│       ├── admin/                        # Admin API (users / songs management)
│       ├── auth/                         # Spotify OAuth
│       ├── spotify/
│       │   ├── config/                   # Poll mode config for client
│       │   ├── now-playing/              # Current track (REST)
│       │   ├── now-playing/stream/       # SSE endpoint (server mode only)
│       │   └── status/                   # Connection status
│       └── me/                           # Current user
├── components/
│   ├── home/                             # SongFilterBar, CollectionsPanel, PlaylistImportDialog
│   ├── song/                             # ToolbarMenu, MobileMenu (menu items/types)
│   ├── admin/                            # AdminTabs, AdminUserList, AdminSongList, AdminPendingList, BlockUserDialog, TranslationConfigPanel, admin-types
│   ├── timeline/                         # SpotifyStatusCard, OffsetControls, MarkCurrentLineCard, TimelineLineRow
│   ├── LyricsDotGrid.tsx                 # Dot-matrix canvas (spotlight + mic spectrum)
│   ├── ExperimentsPanel.tsx              # Experiments: mic spectrum toggle
│   ├── TranslationStatusOverlay.tsx      # Translation progress bubble + reasoning panel
│   ├── SongForm.tsx, FuriganaEditor.tsx, CoverImage.tsx, SongItemCard.tsx
│   └── ui/                               # Small primitives
├── hooks/
│   ├── useSongData.ts                    # Song data + translation orchestration
│   ├── useSpotifySync.ts                 # Playback state + lyrics sync (Apple-style eased scroll)
│   ├── useNowPlaying.ts                  # SSE + polling dual mode
│   ├── useSpectrumCapture.ts             # Mic → AnalyserNode → shared spectrum buffer
│   └── useCoverPalette.ts                # Cover-derived accent colors
├── lib/
│   ├── db.ts, schema.ts                  # @libsql/client + Drizzle schema
│   ├── translation/                      # config / prompts / parse / index (providers + streaming)
│   ├── translation-stream.ts             # Client-side SSE reader for /translate
│   ├── translation-errors.ts             # Error-code → i18n-key map
│   ├── share-card.ts                     # Pure canvas drawing for share cards
│   ├── scroll-ease.ts                    # Apple-style eased scroll animation
│   ├── lrc.ts, match.ts, romaji.ts, lyrics-fetcher.ts, linkcore-lyrics.ts
│   ├── kuroshiro-client.ts               # Client-side furigana (CDN lazy-load)
│   ├── spotify.ts, spotify-poller.ts     # Spotify token management + server poller
│   ├── auth.ts, auth-session.ts, login-gate.ts
│   ├── cover-color.ts, cover-compress.ts, cover-store.ts   # Cover palette + R2/blob storage
│   ├── ai-usage.ts                       # Daily translation quota tracking
│   ├── theme.tsx, i18n.tsx               # ThemeProvider + I18nProvider
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
| `/api/songs/[id]/translate` | POST | SSE stream — `reasoning` / `done` (translations) / `error` events |
| `/api/admin/users` | GET | List users (admin only) |
| `/api/admin/users/[id]` | PUT/DELETE | Toggle admin/block, delete user (admin only) |
| `/api/admin/songs` | GET | List all songs (admin only) |
| `/api/admin/songs/[id]` | PUT/DELETE | Toggle visibility / approve / delete (admin only) |
| `/api/auth/login` | GET | Spotify OAuth login |
| `/api/auth/callback` | GET | Spotify OAuth callback |
| `/api/spotify/config` | GET | Poll mode config |
| `/api/spotify/now-playing` | GET | Current track (REST) |
| `/api/spotify/now-playing/stream` | GET | SSE now-playing (server mode only) |
| `/api/collections` | GET/POST | Collections CRUD |
| `/api/me` | GET | Current authenticated user |

## Experiments

Open the song page → **More** menu (desktop toolbar or mobile overflow) → **Experiments**:

- **Capture mic spectrum** — lights the dot grid's bottom rows with a live frequency wave (peak capped at 1/3 of panel height). The toggle persists while the panel is closed; the mic is released when the toggle is off or you leave the page. Requires a secure context (HTTPS or localhost) and mic permission.

## License

[MIT](LICENSE)
