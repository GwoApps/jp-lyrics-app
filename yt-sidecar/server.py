"""
ytmusicapi sidecar — HTTP lyrics provider plugin (jplrc-lyrics-provider v1).

A reference implementation of the plugin protocol documented in
`examples/provider-plugin/README.md` (deployment notes: yt-sidecar/README.md):

  GET  /manifest.json  → capability negotiation
  POST /v1/search      → lyric candidates for one structured track
  GET  /health         → liveness probe

The plugin only *retrieves candidates*; scoring, LRC validation, low-confidence
review and persistence are owned by jplrc. Wire shapes and the upstream
ytmusicapi adaptation live in provider_core.py; the bounded upstream session,
the request budget and the thread-safe client holder live in yt_client.py.

Concurrency model (ISSUE #353): every ytmusicapi call is *blocking* (requests),
so the search handler is a plain ``def`` — FastAPI runs it in its threadpool and
the single event loop stays free for `/health`, `/manifest.json` and other
searches. The shared client is handed out by `YTMusicHolder` under a lock and
the empty-search guard is a lock-protected instance (no unguarded module
globals), so concurrent searches cannot corrupt either.

Requires:  pip install -r requirements.txt
Optional:  YT_MUSIC_OAUTH=path/to/oauth.json          (authenticated session)
           YT_MUSIC_PORT=8910                         (listen port)
           YT_MUSIC_DEADLINE_SECONDS=12               (whole-search budget)
           YT_MUSIC_TIMEOUT_SECONDS=30                (per upstream call ceiling)

Run directly:  python server.py
"""

import asyncio
import logging
import os
import sys
import threading

from provider_core import (
    MAX_LYRICS_FETCHES,
    PROTOCOL_VERSION,
    EmptySearchGuard,
    bearer_ok,
    deadline_exceeded,
    manifest,
    register_deadline_exception,
    search_candidates,
)
from yt_client import (
    WORKER_ABORT_SLACK_SECONDS,
    Deadline,
    UpstreamDeadlineExceeded,
    build_upstream_session,
    build_ytmusic,
    search_deadline_seconds,
)

register_deadline_exception(UpstreamDeadlineExceeded)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("yt-sidecar")


class YTMusicHolder:
    """
    Thread-safe, lazily built ytmusicapi client.

    The client is shared for connection pooling; building it and recycling it
    after soft-throttling both happen under `_lock`, and the session object
    itself is never rebuilt in place (the holder swaps the reference), so a
    request that already took a client keeps a consistent view. A `generation`
    counter lets a caller report whether its own outcome triggered the recycle.
    """

    def __init__(self, builder=None):
        self._builder = builder or self._default_builder
        self._lock = threading.Lock()
        self._client = None
        self._generation = 0

    @staticmethod
    def _default_builder():
        oauth_path = os.environ.get("YT_MUSIC_OAUTH")
        session = build_upstream_session()
        if oauth_path and os.path.isfile(oauth_path):
            try:
                client = build_ytmusic(oauth_path, session=session)
                logger.info("ytmusicapi initialized with OAuth: %s", oauth_path)
                return client
            except Exception as exc:
                logger.warning(
                    "YT_MUSIC_OAUTH unusable (%s); falling back to unauthenticated session",
                    exc,
                )
        client = build_ytmusic(None, session=session)
        logger.info("ytmusicapi initialized without auth")
        return client

    def get(self):
        """Return `(client, generation)`; builds it once, under the lock."""
        with self._lock:
            if self._client is None:
                self._client = self._builder()
                self._generation += 1
            return self._client, self._generation

    def reset(self, reason: str, generation=None) -> bool:
        """
        Drop the shared client so the next request builds a fresh session.

        With `generation`, the reset is skipped when another request already
        recycled it (the caller's information is stale) — avoids a needless
        rebuild storm when several searches report the same outage.
        """
        with self._lock:
            if generation is not None and generation != self._generation:
                return False
            self._client = None
        logger.info("ytmusicapi session reset (%s)", reason)
        return True


#: One guard for the process; `EmptySearchGuard` mutations are lock-protected.
_guard = EmptySearchGuard()
#: Serialises the guard's read-modify-write (see `_observe_empty_search`).
_guard_lock = threading.Lock()
_ytmusic_holder = YTMusicHolder()


def _observe_empty_search(hit_count: int, client_generation: int) -> None:
    """
    Record one search outcome and recycle the matching client generation.

    The reset is deferred until after the guard's own lock is released and is
    keyed to the generation the caller actually used, so a concurrent request
    that already observed the reset cannot trigger a second one.
    """
    with _guard_lock:
        recycle = _guard.observe(hit_count)
    if recycle:
        _ytmusic_holder.reset("consecutive empty/failed searches", generation=client_generation)


# ── FastAPI app ──

try:
    from fastapi import FastAPI, Request
    from fastapi.concurrency import run_in_threadpool
    from fastapi.responses import JSONResponse
    from pydantic import BaseModel, Field
except ImportError:
    print("Install fastapi: pip install fastapi uvicorn", file=sys.stderr)
    sys.exit(1)

app = FastAPI(title="ytmusicapi sidecar (jplrc-lyrics-provider v1)")

# Optional bearer auth for public deployments (PROVIDER_TOKEN env). Empty /
# unset = trusted-network mode (the compose deployment default). Pair it with
# `auth_type: bearer` + the same token on the jplrc provider row.
TOKEN = os.environ.get("PROVIDER_TOKEN") or None

class Track(BaseModel):
    title: str = ""
    artists: list[str] = Field(default_factory=list)
    album: str | None = None
    duration_ms: int | None = None
    isrc: str | None = None
    spotify_track_id: str | None = None
    locale: str | None = None


class SearchRequest(BaseModel):
    """The jplrc-lyrics-provider v1 search body (unknown fields are ignored)."""

    protocol_version: int
    request_id: str | None = None
    track: Track
    accept: list[str] = Field(default_factory=lambda: ["synced", "plain"])
    max_candidates: int | None = None


def _error(status: int, code: str, message: str) -> JSONResponse:
    """The protocol's optional error body (diagnostic only, never user-facing)."""
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


def search_worker_ceiling_seconds() -> float:
    """
    Hard ceiling for the blocking worker, budget + `WORKER_ABORT_SLACK_SECONDS`.

    The deadline already bounds every realistic path (it shrinks each upstream
    call's timeout and is re-checked between songs); this only aborts a worker
    that somehow ignored the budget entirely — a wedged socket that never
    returns from `requests` — so the threadpool cannot leak workers.
    """
    return search_deadline_seconds() + WORKER_ABORT_SLACK_SECONDS


def _run_search(req: SearchRequest) -> list[dict]:
    """
    Blocking body of a search: build the deadline, take the shared client, scan.

    Runs in FastAPI's threadpool (see `search`). Raises
    `UpstreamDeadlineExceeded` when the budget is spent — observed between calls
    or reported by the bounded session — which the handler maps to the
    protocol's `503 temporary_unavailable`. It is also raised (rather than
    treated as a per-song miss) by `provider_core`, which recognises the type
    through `register_deadline_exception`.
    """
    deadline = Deadline(search_deadline_seconds(), stage="search")
    ytmusic, generation = _ytmusic_holder.get()
    try:
        candidates = search_candidates(
            ytmusic,
            req.track.model_dump(),
            min(req.max_candidates or MAX_LYRICS_FETCHES, MAX_LYRICS_FETCHES),
            deadline=deadline,
        )
    except Exception:
        # A failed or budget-exhausted search counts as an empty one for the
        # soft-throttling guard, then propagates for the handler to classify.
        _observe_empty_search(0, generation)
        raise
    _observe_empty_search(len(candidates), generation)
    return candidates


def _is_deadline_error(exc: BaseException) -> bool:
    """True for the sidecar's own budget error or one the adapter reported."""
    return isinstance(exc, UpstreamDeadlineExceeded) or deadline_exceeded(exc)


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/manifest.json")
def manifest_endpoint(request: Request):
    """
    Sync handler on purpose: `/manifest.json` answers from the manifest constant,
    so running it in the threadpool keeps *every* blocking-capable path off the
    event loop and guarantees the probe answers while a search is in flight.
    """
    if not bearer_ok(request.headers.get("authorization"), TOKEN):
        return _error(401, "auth_failed", "missing or invalid bearer token")
    return manifest()


@app.post("/v1/search")
async def search(req: SearchRequest, request: Request):
    if not bearer_ok(request.headers.get("authorization"), TOKEN):
        return _error(401, "auth_failed", "missing or invalid bearer token")
    if req.protocol_version != PROTOCOL_VERSION:
        return _error(400, "invalid_request", f"unsupported protocol_version: {req.protocol_version}")

    try:
        # Off-loop: search_candidates is blocking (requests), and the whole call
        # is additionally bounded so a wedged worker cannot pin the request.
        candidates = await asyncio.wait_for(
            run_in_threadpool(_run_search, req),
            timeout=search_worker_ceiling_seconds(),
        )
    except asyncio.TimeoutError:
        ceiling = search_worker_ceiling_seconds()
        logger.warning("search worker exceeded its %gs ceiling; aborting", ceiling)
        return _error(
            503,
            "temporary_unavailable",
            f"search exceeded the {search_deadline_seconds():g}s upstream budget",
        )
    except Exception as exc:
        if _is_deadline_error(exc):
            logger.warning(
                "search stopped after the %gs upstream budget: %s",
                search_deadline_seconds(),
                exc,
            )
            return _error(
                503,
                "temporary_unavailable",
                f"upstream budget of {search_deadline_seconds():g}s exceeded",
            )
        logger.error("upstream search failed: %s", exc)
        return _error(503, "temporary_unavailable", "upstream search failed")

    # A miss is a normal 200 with an empty list — never a 4xx/5xx.
    return {
        "protocol_version": PROTOCOL_VERSION,
        "request_id": req.request_id,
        "candidates": candidates,
    }


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("YT_MUSIC_PORT", "8910"))
    uvicorn.run(app, host="0.0.0.0", port=port)
