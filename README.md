# 歌詞ノート (Kashi Note)

A Japanese lyrics management web app with furigana display and Spotify sync.

[日本語](README-ja.md) | [中文](README-zh.md)

## Features

- **Lyrics Input** — Paste Japanese lyrics with kanji; kuroshiro auto-converts to hiragana furigana on save
- **Furigana Display** — Ruby annotations above kanji via `<ruby>` tags. Adjustable font size (12–28px)
- **Spotify Sync** — OAuth-connected Spotify playback tracking with real-time line-by-line auto-scroll
- **lrclib.net Sync** — Fetches timestamped lyrics from lrclib.net for precise per-line synchronization
- **One-Click Import** — Playing an untracked song? Import lyrics from lrclib and jump to the detail page instantly
- **Mobile Responsive** — Adaptive UI with icon-only buttons on mobile, stacked layouts, and compact spacing

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| UI | React 19, Tailwind CSS, Lucide Icons |
| Database | SQLite (better-sqlite3) |
| Furigana Engine | kuroshiro + kuromoji |
| Lyrics Source | lrclib.net (primary), Spotify unofficial API |
| Music Integration | Spotify Web API (OAuth 2.0) |
| Deployment | Docker, Traefik reverse proxy |

## Project Structure

```
src/
├── app/
│   ├── page.tsx                    # Song list (with Now Playing bar)
│   ├── layout.tsx                  # Layout (navigation bar)
│   ├── globals.css                 # Global styles
│   ├── songs/
│   │   ├── new/page.tsx            # Add new song
│   │   └── [id]/
│   │       ├── page.tsx            # Song detail (Spotify sync, debug mode)
│   │       └── edit/page.tsx       # Edit song
│   └── api/
│       ├── songs/
│       │   ├── route.ts            # GET: list, POST: create
│       │   ├── import/route.ts     # POST: one-click import from lrclib
│       │   └── [id]/
│       │       ├── route.ts        # GET/PUT/DELETE: single song
│       │       └── sync/route.ts   # POST: fetch synced lyrics (lrclib → Spotify fallback)
│       ├── auth/
│       │   ├── login/route.ts      # Spotify OAuth login
│       │   └── callback/route.ts   # Spotify OAuth callback
│       └── spotify/
│           ├── now-playing/route.ts # Currently playing track
│           └── status/route.ts     # Spotify connection status
└── lib/
    ├── db.ts                       # SQLite connection & schema
    ├── kuroshiro.ts                # Furigana conversion logic
    ├── spotify.ts                  # Spotify API credentials
    └── types.ts                    # Shared type definitions
```

## Local Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev
# → http://localhost:3000

# Production build
npm run build
```

### Environment Variables

Create a `.env` file:

```env
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
```

Create an app on the Spotify Developer Dashboard and set the redirect URI to `http://localhost:3000/api/auth/callback`.

## Docker Deployment

```bash
# Build & start
docker compose up -d --build

# View logs
docker compose logs -f
```

`docker-compose.yml` assumes Traefik reverse proxy. Protected by `kazusa-auth` middleware.

## API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/api/songs` | GET | List all songs |
| `/api/songs` | POST | Create song (auto furigana conversion) |
| `/api/songs/import` | POST | One-click import from lrclib |
| `/api/songs/[id]` | GET | Song detail |
| `/api/songs/[id]` | PUT | Update song |
| `/api/songs/[id]` | DELETE | Delete song |
| `/api/songs/[id]/sync` | POST | Fetch synced lyrics (lrclib → Spotify fallback) |
| `/api/auth/login` | GET | Spotify OAuth login |
| `/api/spotify/now-playing` | GET | Currently playing track info |

## License

Private
