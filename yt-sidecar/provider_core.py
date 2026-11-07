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

import hmac
import inspect
import time
from functools import lru_cache
from typing import Any, Callable, Optional

PROTOCOL_NAME = "jplrc-lyrics-provider"
PROTOCOL_VERSION = 1

PROVIDER_ID = "ytmusic"
PROVIDER_NAME = "YouTube Music"
PROVIDER_VERSION = "2.0.0"

# Songs scanned per search before lyrics lookup…
SEARCH_LIMIT = 5
# …and how many of those get a lyrics lookup (each costs two upstream calls).
MAX_LYRICS_FETCHES = 3

# The cheapest upstream query ytmusicapi offers: it reuses the session the
# plugin already holds (no lyrics browse, no extra HTTP round trip beyond the
# one search) and any non-empty result set proves the session still works —
# an expired OAuth file or a soft-throttled session fails or returns nothing.
PROBE_QUERY = "a"
# How long a deep probe result drives /health?deep=1. Probes are meant to run on
# a container healthcheck interval, so the cache keeps repeated calls from
# hammering the upstream while still surfacing degradation within the minute.
HEALTH_PROBE_TTL_S = 60.0


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


@lru_cache(maxsize=256)
def _accepts_timeout(func: Callable[..., Any]) -> bool:
    """
    True when `func` declares a `timeout` parameter (or `**kwargs`).

    Decided from the signature, never by catching a `TypeError` from the call
    itself — a `TypeError` raised *inside* the upstream method must not cause a
    silent retry (and a duplicate upstream request).
    """
    try:
        parameters = inspect.signature(func).parameters
    except (TypeError, ValueError):  # builtins / exotic callables
        return False
    if "timeout" in parameters:
        return True
    return any(p.kind is inspect.Parameter.VAR_KEYWORD for p in parameters.values())


def _bounded_call(func: Callable[..., Any], timeout: Optional[float], *args, **kwargs) -> Any:
    """
    Call an upstream adapter method with an optional per-call `timeout`.

    ytmusicapi's methods take no `timeout`, so the argument is carried only when
    the callable accepts it (its transport bound lives in `yt_client` instead).
    """
    if timeout is not None and _accepts_timeout(func):
        kwargs["timeout"] = timeout
    return func(*args, **kwargs)


#: Exception types that mean "the whole-search budget is spent" rather than
#: "this song has no lyrics". `yt_client.UpstreamDeadlineExceeded` is registered
#: by the server (and the tests) via `register_deadline_exception`, keeping this
#: module transport-agnostic (no import cycle: `yt_client` never imports it).
_DEADLINE_EXCEPTIONS: tuple[type, ...] = ()


def register_deadline_exception(*exc_types: type) -> None:
    """Add exception types that must abort a search instead of skipping a song."""
    global _DEADLINE_EXCEPTIONS
    _DEADLINE_EXCEPTIONS = tuple(dict.fromkeys((*_DEADLINE_EXCEPTIONS, *exc_types)))


def deadline_exceeded(exc: BaseException) -> bool:
    """True when `exc` reports that the search budget was spent."""
    return bool(_DEADLINE_EXCEPTIONS) and isinstance(exc, _DEADLINE_EXCEPTIONS)


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


def candidate_from_song(
    ytmusic: Any,
    song: dict,
    timeout: Optional[float] = None,
) -> Optional[dict]:
    """
    Build one protocol candidate from a search result, or None when the song has
    no usable lyrics or lacks identity evidence. Per-song upstream failures are
    soft-skipped so one broken track cannot fail the whole search, and a
    ``timeout`` (seconds) bounds each upstream call when the adapter accepts it
    (ytmusicapi does not, so the transport-level bound in `yt_client` applies).

    A spent budget is **not** a per-song failure: it is re-raised so the caller
    aborts the search and the server can answer `503 temporary_unavailable`
    instead of reporting a misleading empty result.
    """
    video_id = str(song.get("videoId") or "").strip()
    title = str(song.get("title") or "").strip()
    artists = _song_artists(song)
    # Identity evidence is mandatory: jplrc rejects candidates without it, and a
    # candidate echoing the request would prove nothing about the match.
    if not video_id or not title or not artists:
        return None

    try:
        watch = _bounded_call(ytmusic.get_watch_playlist, timeout, videoId=video_id) or {}
    except Exception as exc:
        if deadline_exceeded(exc):
            raise
        return None
    browse_id = watch.get("lyrics")
    if not browse_id:
        return None
    try:
        payload = _bounded_call(ytmusic.get_lyrics, timeout, browse_id, timestamps=True)
    except Exception as exc:
        if deadline_exceeded(exc):
            raise
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
    deadline: Any = None,
    timeout: Optional[float] = None,
) -> list[dict]:
    """
    Retrieve up to `MAX_LYRICS_FETCHES` candidates for one track.

    Raises on a failing upstream search (the server maps it to 503
    `temporary_unavailable`); per-song lookup failures just skip that song.

    ``deadline`` is an optional `yt_client.Deadline`: it is checked *between*
    upstream calls and shrinks each call's timeout, so a stall ends the search
    with a deadline error instead of pinning the worker. Such an error always
    propagates (never soft-skipped as "this song has no lyrics"), so the server
    can answer 503 `temporary_unavailable`. ``timeout`` is an optional per-call
    bound passed through to adapters that accept one.
    """

    def remaining() -> Optional[float]:
        """Per-call bound for the next upstream call, or None when unbounded."""
        if deadline is None:
            return timeout
        if timeout is None:
            return deadline.remaining_timeout(float("inf"))
        return deadline.remaining_timeout(timeout)

    query = build_query(track)
    if not query:
        return []
    results = _bounded_call(ytmusic.search, remaining(), query, filter="songs", limit=SEARCH_LIMIT) or []

    cap = MAX_LYRICS_FETCHES
    if isinstance(max_candidates, (int, float)) and max_candidates > 0:
        cap = max(1, min(int(max_candidates), MAX_LYRICS_FETCHES))

    candidates: list[dict] = []
    for song in results:
        if len(candidates) >= cap:
            break
        if deadline is not None:
            deadline.check()
        # A spent budget must abort the search (-> 503) rather than look like
        # "this song has no lyrics"; per-song lookup failures are already
        # soft-skipped inside candidate_from_song.
        candidate = candidate_from_song(ytmusic, song, timeout=remaining())
        if candidate:
            candidates.append(candidate)
    return candidates


def probe_upstream(ytmusic: Any) -> bool:
    """One cheap question to the upstream: does this session still return data?

    A degraded session does not raise: `YT_MUSIC_OAUTH` that has expired or is
    malformed makes the client fall back to an unauthenticated session, and the
    upstream soft-throttles anonymous callers by answering 200 with an empty
    result set. So a probe that only caught exceptions would report healthy
    exactly when the plugin is silently useless — an empty result set has to
    count as failure.
    """
    return bool(ytmusic.search(PROBE_QUERY, filter="songs", limit=1) or [])


class UpstreamHealthProbe:
    """Caches one `probe_upstream` result for `ttl_s` so probes stay cheap.

    Without the cache every docker healthcheck interval would issue an upstream
    search; with it the upstream sees at most one probe per TTL no matter how
    many callers ask. Results only: the caller decides how to render them.
    """

    def __init__(self, probe: Callable[[], bool], ttl_s: float = HEALTH_PROBE_TTL_S):
        self.probe = probe
        self.ttl_s = max(0.0, float(ttl_s))
        self._at = float("-inf")
        self._ok = False

    def check(self, now: Optional[float] = None) -> bool:
        """Return the cached upstream state, probing again once the TTL lapses."""
        now = time.monotonic() if now is None else now
        if now - self._at >= self.ttl_s:
            try:
                self._ok = bool(self.probe())
            except Exception:
                self._ok = False
            self._at = now
        return self._ok
