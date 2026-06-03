# 歌詞ノート (Kashi Note)

A Japanese lyrics management web app with furigana annotation, Spotify real-time sync, and PWA support.

[日本語](README-ja.md) | [中文](README-zh.md)

## Features

- **Furigana Lyrics** — Paste Japanese lyrics; kuroshiro auto-converts kanji to hiragana furigana via `<ruby>` annotations
- **Spotify Real-Time Sync** — OAuth-connected playback tracking with SSE streaming, line-by-line auto-scroll, and diff protocol
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
| Framework | Next.js 14 (App Router) |
| UI | React 19, Tailwind CSS v4, Lucide Icons |
| Database | SQLite (better-sqlite3) |
| Furigana Engine | kuroshiro + kuromoji |
| Lyrics Source | lrclib.net |
| Music Integration | Spotify Web API (OAuth 2.0) + SSE streaming |
| Deployment | Docker, Traefik reverse proxy |

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

Spotify integration is optional. Without it, you can still manage lyrics manually.

Create an app on the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and set the redirect URI to `http://localhost:3000/api/auth/callback`.

## Docker Deployment

```bash
docker compose up -d --build
```

The included `docker-compose.yml` assumes a Traefik reverse proxy network. Adjust labels for your setup.

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
│       ├── spotify/now-playing/stream/   # SSE endpoint with diff protocol
│       └── me/                           # Current user
├── components/
│   ├── FuriganaLine.tsx                  # Ruby annotation renderer
│   ├── ConfirmDialog.tsx                 # Reusable modal dialog
│   ├── LanguageSwitcher.tsx              # Locale picker
│   └── AppShell.tsx                      # Theme + i18n providers
├── hooks/
│   ├── useNowPlaying.ts                  # SSE + polling fallback
│   ├── useSpotifySync.ts                 # Playback state + lyrics sync
│   └── useSongData.ts                    # Song data + handlers
├── lib/
│   ├── db.ts                             # SQLite connection + schema
│   ├── kuroshiro.ts                      # Furigana conversion
│   ├── match.ts                          # Multi-level song matching
│   ├── lrc.ts                            # LRC parsing utilities
│   ├── spotify-poller.ts                 # Singleton poller with auto-cleanup
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
| `/api/songs` | POST | Create song (auto furigana conversion) |
| `/api/songs/import` | POST | Import from lrclib by title + artist |
| `/api/songs/import-playlist` | POST | Batch import from Spotify playlist |
| `/api/songs/[id]` | GET/PUT/DELETE | Single song CRUD |
| `/api/songs/[id]/sync` | POST | Fetch synced lyrics (lrclib) |
| `/api/songs/[id]/export` | GET | Export as `?format=txt\|lrc\|html` |
| `/api/songs/[id]/favorite` | POST | Toggle favorite |
| `/api/auth/login` | GET | Spotify OAuth login |
| `/api/auth/callback` | GET | Spotify OAuth callback |
| `/api/spotify/now-playing/stream` | GET | SSE now-playing (diff protocol) |
| `/api/collections` | GET/POST | Collections CRUD |
| `/api/me` | GET | Current authenticated user |

## License

[MIT](LICENSE)
