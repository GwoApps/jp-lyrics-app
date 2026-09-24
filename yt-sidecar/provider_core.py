"""
Pure provider logic for the ytmusicapi lyrics plugin (jplrc-lyrics-provider v1).

This module is the protocol heart of the sidecar and doubles as the reference
for writing provider plugins: it turns upstream data into the wire shapes
documented in `examples/provider-plugin/README.md`. It has no web-framework
dependencies and is covered by `test_provider_core.py`
(`python3 -m unittest discover -s yt-sidecar`).

Upstream API notes (ytmusicapi >= 1.12):

* Search results carry NO lyrics browse id — it is discovered per track via
  `get_watch_playlist(videoId=...)` -> ``{"lyrics": "MPLYt..."}`` (or None when
  the track has no lyrics page).
* `get_lyrics(browse_id, timestamps=True)` returns either the timed form
  ``{"lyrics": [LyricLine(text, start_time, end_time, id), ...], "hasTimestamps":
  True}`` (start/end in MILLISECONDS) or the plain form ``{"lyrics": "text",
  "hasTimestamps": False}``, or None.

Protocol reminder (the split of responsibility):
the plugin only *retrieves candidates* with their real matched identity
(title/artists/album/duration/source_url). Scoring, LRC validation, review and
persistence all belong to jplrc — never fabricate identity evidence here.
"""

from typing import Any, Optional
import hmac

PROTOCOL_NAME = "jplrc-lyrics-provider"
PROTOCOL_VERSION = 1

PROVIDER_ID = "ytmusic"
PROVIDER_NAME = "YouTube Music"
PROVIDER_VERSION = "2.0.0"

# Songs scanned per search before lyrics lookup…
SEARCH_LIMIT = 5
# …and how many of those get a lyrics lookup (each costs two upstream calls).
MAX_LYRICS_FETCHES = 3


def manifest() -> dict:
    """The capability document served at ``GET /manifest.json``."""
    return {
        "protocol": PROTOCOL_NAME,
        "protocol_version": PROTOCOL_VERSION,
        "id": PROVIDER_ID,
        "name": PROVIDER_NAME,
        "version": PROVIDER_VERSION,
        "capabilities": ["search", "plain", "synced"],
        "limits": {"max_candidates": MAX_LYRICS_FETCHES},
    }


def bearer_ok(authorization: Optional[str], token: Optional[str]) -> bool:
    """
    Bearer auth check for public deployments. Empty / missing `token` disables
    auth (trusted-network mode); otherwise the header must match
    ``Bearer <token>`` exactly, compared in constant time.
    """
    if not token:
        return True
    return hmac.compare_digest(authorization or "", f"Bearer {token}")


class EmptySearchGuard:
    """
    Recycle the shared upstream session after `threshold` consecutive searches
    with zero candidates (failed searches count as zero). A ytmusicapi session
    can start returning empty result sets (HTTP 200, no error) when the
    upstream soft-throttles it — authenticated or not — and a fresh session
    recovers. A genuine no-hit query can also look empty, so threshold > 1
    keeps false positives cheap (one harmless client rebuild).
    """

    def __init__(self, threshold: int = 2):
        self.threshold = max(1, int(threshold))
        self._streak = 0

    def observe(self, hit_count: int) -> bool:
        """Record one search outcome; True => recycle the upstream client."""
        if hit_count > 0:
            self._streak = 0
            return False
        self._streak += 1
        if self._streak >= self.threshold:
            self._streak = 0
            return True
        return False


def ms_to_lrc(ms: float) -> str:
    """Milliseconds → ``[mm:ss.cc]`` LRC timestamp (minutes unbounded)."""
    total_centis = int(round(float(ms) / 10.0))
    minutes = total_centis // 6000
    seconds = (total_centis // 100) % 60
    centis = total_centis % 100
    return f"{minutes:02d}:{seconds:02d}.{centis:02d}"


def _line_fields(line: Any) -> tuple[str, float]:
    """(text, start_ms) from a LyricLine object or an equivalent dict."""
    if isinstance(line, dict):
        text = str(line.get("text") or "")
        start = float(line.get("start_time") or 0)
    else:
        text = str(getattr(line, "text", "") or "")
        start = float(getattr(line, "start_time", 0) or 0)
    return text.strip(), start


def lyric_lines_to_texts(lines: Any) -> tuple[str, str]:
    """Timed lyric lines → ``(plain, synced)``; empty lines are dropped."""
    plain_rows: list[str] = []
    lrc_rows: list[str] = []
    for line in lines or []:
        text, start_ms = _line_fields(line)
        if not text:
            continue
        lrc_rows.append(f"[{ms_to_lrc(start_ms)}]{text}")
        plain_rows.append(text)
    return "\n".join(plain_rows), "\n".join(lrc_rows)


def lyrics_payload_to_texts(payload: Optional[dict]) -> tuple[str, str]:
    """
    Normalise a `get_lyrics(..., timestamps=True)` payload (timed or plain form)
    into `(plain, synced)`. A timed payload yields both; the plain form yields
    plain text only. None / empty → `('', '')`.
    """
    if not payload:
        return "", ""
    if payload.get("hasTimestamps"):
        return lyric_lines_to_texts(payload.get("lyrics") or [])
    plain = str(payload.get("lyrics") or "").strip()
    return plain, ""


def _song_artists(song: dict) -> list[str]:
    names = []
    for artist in song.get("artists") or []:
        name = str((artist or {}).get("name") or "").strip()
        if name:
            names.append(name)
    return names


def _song_album(song: dict) -> Optional[str]:
    album = song.get("album")
    if isinstance(album, dict):
        name = str(album.get("name") or "").strip()
        return name or None
    if isinstance(album, list) and album:
        name = str((album[0] or {}).get("name") or "").strip()
        return name or None
    return None


def _song_duration_ms(song: dict) -> Optional[int]:
    seconds = song.get("duration_seconds")
    if isinstance(seconds, (int, float)) and seconds > 0:
        return int(round(seconds * 1000))
    return None


def candidate_from_song(ytmusic: Any, song: dict) -> Optional[dict]:
    """
    Build one protocol candidate from a search result, or None when the song has
    no usable lyrics or lacks identity evidence. Per-song upstream failures are
    soft-skipped so one broken track cannot fail the whole search.
    """
    video_id = str(song.get("videoId") or "").strip()
    title = str(song.get("title") or "").strip()
    artists = _song_artists(song)
    # Identity evidence is mandatory: jplrc rejects candidates without it, and a
    # candidate echoing the request would prove nothing about the match.
    if not video_id or not title or not artists:
        return None

    try:
        watch = ytmusic.get_watch_playlist(videoId=video_id) or {}
    except Exception:
        return None
    browse_id = watch.get("lyrics")
    if not browse_id:
        return None
    try:
        payload = ytmusic.get_lyrics(browse_id, timestamps=True)
    except Exception:
        return None

    plain, synced = lyrics_payload_to_texts(payload)
    if not plain and not synced:
        return None

    candidate: dict = {
        "candidate_id": PROVIDER_ID,
        "title": title,
        "artists": artists,
    }
    album = _song_album(song)
    if album:
        candidate["album"] = album
    duration_ms = _song_duration_ms(song)
    if duration_ms:
        candidate["duration_ms"] = duration_ms
    if plain:
        candidate["plain_lyrics"] = plain
    if synced:
        candidate["synced_lyrics"] = synced
    candidate["source_url"] = f"https://music.youtube.com/watch?v={video_id}"
    return candidate


def build_query(track: dict) -> str:
    """Search query from the structured track: `title artist1 artist2 …`."""
    title = str(track.get("title") or "").strip()
    artists = [str(a).strip() for a in track.get("artists") or [] if str(a).strip()]
    return " ".join([title, *artists]).strip()


def search_candidates(
    ytmusic: Any,
    track: dict,
    max_candidates: Optional[int] = None,
) -> list[dict]:
    """
    Retrieve up to `MAX_LYRICS_FETCHES` candidates for one track.

    Raises on a failing upstream search (the server maps it to 503
    `temporary_unavailable`); per-song lookup failures just skip that song.
    """
    query = build_query(track)
    if not query:
        return []
    results = ytmusic.search(query, filter="songs", limit=SEARCH_LIMIT) or []

    cap = MAX_LYRICS_FETCHES
    if isinstance(max_candidates, (int, float)) and max_candidates > 0:
        cap = max(1, min(int(max_candidates), MAX_LYRICS_FETCHES))

    candidates: list[dict] = []
    for song in results:
        if len(candidates) >= cap:
            break
        candidate = candidate_from_song(ytmusic, song)
        if candidate:
            candidates.append(candidate)
    return candidates
