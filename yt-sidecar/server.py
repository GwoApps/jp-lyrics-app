"""
ytmusicapi sidecar — lightweight HTTP service for YouTube Music lyrics.

Endpoints:
  GET /lyrics?q=artist+title   → { synced, plain, source }
  GET /health                  → { ok: true }

Requires: pip install ytmusicapi fastapi uvicorn
Optional: set YT_MUSIC_OAUTH env var path to oauth.json
"""

import os
import re
import sys
import logging
from typing import Optional

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("yt-sidecar")

# ── Lazy init ytmusicapi (heavy import) ──

_ytmusic = None


def get_ytmusic():
    global _ytmusic
    if _ytmusic is None:
        from ytmusicapi import YTMusic
        oauth_path = os.environ.get("YT_MUSIC_OAUTH")
        if oauth_path and os.path.exists(oauth_path):
            _ytmusic = YTMusic(oauth_path)
            logger.info("ytmusicapi initialized with OAuth: %s", oauth_path)
        else:
            _ytmusic = YTMusic()
            logger.info("ytmusicapi initialized without auth")
    return _ytmusic


def ms_to_lrc(ms: float) -> str:
    total_sec = int(ms)
    mins = total_sec // 60
    secs = total_sec % 60
    centis = int((ms - total_sec) * 100)
    return f"{mins:02d}:{secs:02d}.{centis:02d}"


def timestamps_to_lrc(timestamps: list[dict]) -> str:
    lines = []
    for ts in timestamps:
        text = ts.get("text", "").strip()
        start = ts.get("start", 0)
        if text:
            lines.append(f"[{ms_to_lrc(start)}]{text}")
    return "\n".join(lines)


def search_and_get_lyrics(query: str) -> Optional[dict]:
    ytmusic = get_ytmusic()
    try:
        results = ytmusic.search(query, filter="songs", limit=3)
    except Exception as e:
        logger.error("ytmusic search failed: %s", e)
        return None

    for song in results:
        lyrics_info = song.get("lyrics")
        if not lyrics_info or not lyrics_info.get("browseId"):
            continue
        browse_id = lyrics_info["browseId"]
        try:
            # Try synced first
            lyrics = ytmusic.get_lyrics(browse_id, timestamps=True)
            synced = ""
            if "timestamps" in lyrics and lyrics["timestamps"]:
                synced = timestamps_to_lrc(lyrics["timestamps"])
            plain = lyrics.get("lyrics", "")
            if not plain and not synced:
                continue
            return {
                "synced": synced,
                "plain": plain,
                "source": lyrics.get("source", "ytmusic"),
            }
        except Exception as e:
            logger.warning("get_lyrics failed for %s: %s", browse_id, e)
            continue

    return None


# ── FastAPI app ──

try:
    from fastapi import FastAPI, Query
    from fastapi.responses import JSONResponse
except ImportError:
    print("Install fastapi: pip install fastapi uvicorn", file=sys.stderr)
    sys.exit(1)

app = FastAPI(title="ytmusicapi sidecar")


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/lyrics")
async def lyrics(q: str = Query(..., description="Search query (artist + title)")):
    result = search_and_get_lyrics(q)
    if not result:
        return JSONResponse(status_code=404, content={"error": "No lyrics found"})
    return result


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("YT_MUSIC_PORT", "8910"))
    uvicorn.run(app, host="0.0.0.0", port=port)
