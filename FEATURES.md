# Features

Detailed feature walkthrough for 歌詞ノート (Kashi Note). For setup and
deployment see [README.md](README.md) and [DEPLOYMENT.md](DEPLOYMENT.md).

---

## Lyrics Reading

- **Furigana Lyrics** — Paste Japanese lyrics; client-side kuromoji-es
  auto-converts kanji to hiragana furigana via `<ruby>` annotations
  (lazy-loaded on first use, works offline after that).
- **Reading Modes** — Switch between original lyrics, furigana, and
  Hepburn-style romaji; the preference is remembered locally.
- **Adjustable Font Size** — A−/A+ controls for comfortable reading.
- **Lyrics Dot Grid** — Canvas dot-matrix background behind the lyrics with
  a pointer spotlight. Tunable live from the debug panel (spacing, dot
  size, spotlight radius, glow, magnet pull).
- **Apple-style Follow Scroll** — While syncing, the active line is
  centered with an eased scroll animation (fast start, graceful deceleration).
- **Copy Lyrics** — Strip furigana, copy clean text to clipboard.
- **Export** — Download lyrics as plain text, LRC (timestamped), or HTML.
- **PiP (Picture-in-Picture)** — Floating lyrics window over other apps
  (desktop Chrome).

## Lyrics Sources

- **lrclib.net Sync** — Fetch timestamped lyrics for precise per-line
  synchronization (with fallback providers and heuristic match scoring).
- **One-Click Import** — Import lyrics for the currently playing Spotify
  track instantly.
- **Playlist Batch Import** — Import all tracks from a Spotify playlist at
  once, with per-track result reporting.

## Timeline Annotation Workspace

- Mark previously untimed lyrics **line by line** against live Spotify
  progress (keyboard shortcuts: `Enter` mark, `↑/↓` navigate, `Ctrl/Cmd+Z`
  undo, `Ctrl/Cmd+S` save).
- Save partial work at any time; reopen and continue.
- Replay marked positions (seek Spotify to any line), clear individual
  timestamps, and apply global offsets (±500/±100ms quick buttons or a
  custom value) to shift the whole draft.
- Live progress card, track-mismatch warning, and dirty-state leave guard.

## AI Lyric Translation

- **SSE streaming** — Translations stream in as the model thinks; a live
  **reasoning panel** shows the model's thought process chunk by chunk
  (auto-scrolls unless you scroll up to inspect).
- **Terminology glossary** — Extracts names/terms from the source lyrics
  and injects them into the prompt for consistent translations.
- **Pluggable providers** — OpenAI-compatible APIs, Anthropic Messages API,
  and Cloudflare Workers AI (`TRANSLATION_PROVIDER`).
- **Resilience** — Retry with backoff on transient failures, per-error
  localized messages, and a daily token quota
  (`AI_DAILY_NEURON_LIMIT`, `429 / ai_quota_exceeded` → quota toast).
- **Whole-song workspace** — `/songs/[id]/translation` translates the full
  lyrics into the target language (SSE, `max_tokens` 32768).

## Spotify Integration

- OAuth 2.0 login with an optional passphrase gate.
- **Real-time sync** — line-by-line auto-scroll with the currently playing
  track. Server mode (Node singleton poller + SSE) or client mode
  (browser polling), see `SPOTIFY_POLL_MODE`.
- **Canonical metadata** — stable Track IDs, URI, album, duration, cover,
  and canonical title/artist persisted for exact matching; provenance
  (provider, match confidence, fetch time) recorded.
- One-click import of the playing track; seeking from the timeline.

## Share Cards

- Generate a shareable **canvas image** (landscape 1200×630 or portrait
  630×1200) with the cover art, selected lyric lines, a QR code linking
  back to the song, and the site name — download as PNG.
- Select/deselect individual lines (`?line=` deep-links a selection).

## Admin Console

`/admin` (admins only):

- **Users** — promote/demote admins, block/unblock (with reason),
  delete users (self-protected).
- **Songs** — toggle public/private visibility, approve or reject
  public-approval requests (pending queue with prominent actions),
  delete songs.
- **Translation service** — live provider/model configuration and a
  connectivity test against the configured API.

## Experiments

Open a song page → **More** menu (desktop toolbar or mobile overflow) →
**Experiments**:

- **Capture mic spectrum** — lights the dot grid's bottom rows with a live
  frequency wave (Web Audio `AnalyserNode`, `fftSize` 2048 ≈ 23 Hz
  resolution; log-spaced bins mapped across the full panel width; peak
  capped at 1/3 of panel height; dB-style scaling).
- The toggle **persists** while the panel is closed; the mic is released
  only when the toggle is off or you leave the page (unmount).
- Requires a secure context (HTTPS or localhost) and mic permission.

## Platform

- **PWA** — Installable on Android/iOS with offline caching and update
  notifications.
- **Dark / Light Theme** — System-aware with manual toggle, persisted via
  localStorage.
- **Multi-Language UI** — Japanese, English, Simplified Chinese,
  Traditional Chinese (auto-detected from browser).
- **Favorites & Collections** — Star songs, organize into collections,
  filter by favorites, bulk-manage from the home page.
- **Responsive** — Mobile-optimized bottom bar with a 3-dot overflow menu;
  desktop toolbar menu for the same actions.
