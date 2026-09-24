"""
ytmusicapi sidecar — HTTP lyrics provider plugin (jplrc-lyrics-provider v1).

A reference implementation of the plugin protocol documented in
`examples/provider-plugin/README.md` (deployment notes: yt-sidecar/README.md):

  GET  /manifest.json  → capability negotiation
  POST /v1/search      → lyric candidates for one structured track
  GET  /health         → liveness probe

The plugin only *retrieves candidates*; scoring, LRC validation, low-confidence
review and persistence are owned by jplrc. Wire shapes and the upstream
ytmusicapi adaptation live in provider_core.py.

Requires:  pip install ytmusicapi fastapi uvicorn
Optional:  YT_MUSIC_OAUTH=path/to/oauth.json   (authenticated ytmusicapi session)
           YT_MUSIC_PORT=8910                  (listen port)

Run directly:  python server.py
"""

import logging
import os
import sys

from provider_core import (
    MAX_LYRICS_FETCHES,
    PROTOCOL_VERSION,
    EmptySearchGuard,
    bearer_ok,
    manifest,
    search_candidates,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("yt-sidecar")

# ── Lazy init ytmusicapi (heavy import) ──

_ytmusic = None
# Recycles the shared session after consecutive empty/failed searches (see
# provider_core.EmptySearchGuard): upstream soft-throttling can make a session
# return empty result sets with no error; a fresh session recovers.
_guard = EmptySearchGuard()


def get_ytmusic():
    global _ytmusic
    if _ytmusic is None:
        from ytmusicapi import YTMusic
        oauth_path = os.environ.get("YT_MUSIC_OAUTH")
        if oauth_path and os.path.isfile(oauth_path):
            try:
                _ytmusic = YTMusic(oauth_path)
                logger.info("ytmusicapi initialized with OAuth: %s", oauth_path)
            except Exception as exc:
                logger.warning(
                    "YT_MUSIC_OAUTH unusable (%s); falling back to unauthenticated session",
                    exc,
                )
        if _ytmusic is None:
            _ytmusic = YTMusic()
            logger.info("ytmusicapi initialized without auth")
    return _ytmusic


def reset_ytmusic(reason: str):
    """Drop the shared client so the next request builds a fresh session."""
    global _ytmusic
    _ytmusic = None
    logger.info("ytmusicapi session reset (%s)", reason)


# ── FastAPI app ──

try:
    from fastapi import FastAPI, Request
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


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/manifest.json")
async def manifest_endpoint(request: Request):
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
        ytmusic = get_ytmusic()
    except Exception as exc:
        logger.error("ytmusicapi init failed: %s", exc)
        return _error(503, "temporary_unavailable", "ytmusicapi init failed")

    try:
        candidates = search_candidates(
            ytmusic,
            req.track.model_dump(),
            min(req.max_candidates or MAX_LYRICS_FETCHES, MAX_LYRICS_FETCHES),
        )
    except Exception as exc:
        logger.error("upstream search failed: %s", exc)
        if _guard.observe(0):
            reset_ytmusic("consecutive empty/failed searches")
        return _error(503, "temporary_unavailable", "upstream search failed")

    if _guard.observe(len(candidates)):
        reset_ytmusic("consecutive empty searches")

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
