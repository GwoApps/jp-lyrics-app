"""
Unit tests for provider_core.py (stdlib only, no ytmusicapi/fastapi needed):

    python3 -m unittest discover -s yt-sidecar

Fake upstreams duck-type the two ytmusicapi calls the plugin makes:
`search(query, filter=..., limit=...)` and `get_watch_playlist(videoId=...)` /
`get_lyrics(browse_id, timestamps=True)`.
"""

import unittest

from provider_core import (
    MAX_LYRICS_FETCHES,
    PROVIDER_ID,
    build_query,
    candidate_from_song,
    lyric_lines_to_texts,
    lyrics_payload_to_texts,
    manifest,
    ms_to_lrc,
    search_candidates,
)


def line(text, start_ms):
    """A LyricLine-shaped fake (attributes, like the real dataclass)."""
    return type("LyricLine", (), {"text": text, "start_time": start_ms, "end_time": 0, "id": 0})()


SONG = {
    "title": "夜に駆ける",
    "videoId": "abcd1234",
    "artists": [{"name": "YOASOBI", "id": "x"}],
    "album": {"name": "THE BOOK", "id": "y"},
    "duration_seconds": 261,
}

TIMED = {
    "lyrics": [line("ふと目が覚めれば", 9200), line("", 10000), line("真夜中のドアをたたき", 12540)],
    "source": "Source: LyricFind",
    "hasTimestamps": True,
}

PLAIN = {"lyrics": "ふと目が覚めれば\n真夜中のドアをたたき", "source": "Source: LyricFind", "hasTimestamps": False}


class FakeYTMusic:
    """Scripted upstream: `lyrics_by_video` maps videoId → payload or Exception."""

    def __init__(self, songs, lyrics_by_video=None, watch_missing=()):
        self.songs = songs
        self.lyrics_by_video = lyrics_by_video or {}
        self.watch_missing = set(watch_missing)
        self.search_queries = []
        self.watch_calls = []
        self.lyrics_calls = []

    def search(self, query, filter=None, limit=None):
        self.search_queries.append({"query": query, "filter": filter, "limit": limit})
        return self.songs

    def get_watch_playlist(self, videoId=None, **kwargs):
        self.watch_calls.append(videoId)
        if videoId in self.watch_missing:
            return {"tracks": [], "playlistId": None, "lyrics": None, "related": None}
        return {"tracks": [], "playlistId": None, "lyrics": f"MPLYt_{videoId}", "related": None}

    def get_lyrics(self, browseId, timestamps=False):
        self.lyrics_calls.append(browseId)
        video_id = browseId.removeprefix("MPLYt_")
        payload = self.lyrics_by_video.get(video_id)
        if isinstance(payload, Exception):
            raise payload
        return payload


class TestManifest(unittest.TestCase):
    def test_manifest_matches_protocol_v1(self):
        m = manifest()
        self.assertEqual(m["protocol"], "jplrc-lyrics-provider")
        self.assertEqual(m["protocol_version"], 1)
        self.assertEqual(m["id"], PROVIDER_ID)
        self.assertTrue(isinstance(m["name"], str) and m["name"])
        self.assertTrue(isinstance(m["version"], str) and m["version"])
        self.assertIn("synced", m["capabilities"])
        self.assertIn("plain", m["capabilities"])
        self.assertEqual(m["limits"]["max_candidates"], MAX_LYRICS_FETCHES)


class TestLrc(unittest.TestCase):
    def test_ms_to_lrc_converts_milliseconds(self):
        self.assertEqual(ms_to_lrc(0), "00:00.00")
        self.assertEqual(ms_to_lrc(9200), "00:09.20")
        self.assertEqual(ms_to_lrc(61500), "01:01.50")
        self.assertEqual(ms_to_lrc(3_600_000 + 1234), "60:01.23")

    def test_lyric_lines_to_texts_builds_plain_and_synced(self):
        plain, synced = lyric_lines_to_texts(TIMED["lyrics"])
        self.assertEqual(plain, "ふと目が覚めれば\n真夜中のドアをたたき")
        self.assertEqual(
            synced,
            "[00:09.20]ふと目が覚めれば\n[00:12.54]真夜中のドアをたたき",
        )

    def test_lyric_lines_accept_dict_shapes(self):
        plain, synced = lyric_lines_to_texts([{"text": "hello", "start_time": 100}])
        self.assertEqual(plain, "hello")
        self.assertEqual(synced, "[00:00.10]hello")

    def test_payload_normalisation(self):
        self.assertEqual(lyrics_payload_to_texts(TIMED)[1].count("\n"), 1)
        self.assertEqual(lyrics_payload_to_texts(PLAIN), (PLAIN["lyrics"], ""))
        self.assertEqual(lyrics_payload_to_texts(None), ("", ""))
        self.assertEqual(lyrics_payload_to_texts({"lyrics": [], "hasTimestamps": True}), ("", ""))


class TestSearch(unittest.TestCase):
    def test_build_query_joins_title_and_artists(self):
        self.assertEqual(build_query({"title": "夜に駆ける", "artists": ["YOASOBI"]}), "夜に駆ける YOASOBI")
        self.assertEqual(build_query({"title": "t", "artists": []}), "t")
        self.assertEqual(build_query({}), "")

    def test_candidate_carries_real_identity_and_lyrics(self):
        yt = FakeYTMusic([SONG], {"abcd1234": TIMED})
        candidates = search_candidates(yt, {"title": "夜に駆ける", "artists": ["YOASOBI"]})
        self.assertEqual(len(candidates), 1)
        c = candidates[0]
        # Identity comes from the SEARCH RESULT, never from the request.
        self.assertEqual(c["candidate_id"], PROVIDER_ID)
        self.assertEqual(c["title"], "夜に駆ける")
        self.assertEqual(c["artists"], ["YOASOBI"])
        self.assertEqual(c["album"], "THE BOOK")
        self.assertEqual(c["duration_ms"], 261000)
        self.assertEqual(c["source_url"], "https://music.youtube.com/watch?v=abcd1234")
        self.assertIn("synced_lyrics", c)
        self.assertIn("plain_lyrics", c)

    def test_plain_only_payload_yields_plain_without_synced(self):
        yt = FakeYTMusic([SONG], {"abcd1234": PLAIN})
        c = search_candidates(yt, {"title": "t", "artists": ["a"]})[0]
        self.assertEqual(c["plain_lyrics"], PLAIN["lyrics"])
        self.assertNotIn("synced_lyrics", c)

    def test_miss_returns_empty_list_not_error(self):
        yt = FakeYTMusic([SONG], {"abcd1234": None}, watch_missing={"abcd1234"})
        self.assertEqual(search_candidates(yt, {"title": "t", "artists": ["a"]}), [])

    def test_song_without_identity_evidence_is_skipped(self):
        no_artists = dict(SONG, artists=[])
        no_video = dict(SONG, videoId=None)
        yt = FakeYTMusic([no_artists, no_video], {"abcd1234": TIMED})
        self.assertEqual(search_candidates(yt, {"title": "t", "artists": ["a"]}), [])
        self.assertEqual(yt.watch_calls, [])

    def test_per_song_lyrics_failure_skips_song_only(self):
        broken = dict(SONG, videoId="bad1")
        yt = FakeYTMusic([broken, SONG], {"bad1": RuntimeError("boom"), "abcd1234": TIMED})
        candidates = search_candidates(yt, {"title": "t", "artists": ["a"]})
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["source_url"], "https://music.youtube.com/watch?v=abcd1234")

    def test_candidate_count_is_capped_by_fetch_budget(self):
        songs = [dict(SONG, videoId=f"v{i}", title=f"song{i}") for i in range(5)]
        lyrics = {f"v{i}": TIMED for i in range(5)}
        yt = FakeYTMusic(songs, lyrics)
        candidates = search_candidates(yt, {"title": "t", "artists": ["a"]}, max_candidates=20)
        self.assertEqual(len(candidates), MAX_LYRICS_FETCHES)
        self.assertEqual(len(yt.lyrics_calls), MAX_LYRICS_FETCHES)

    def test_candidate_from_song_handles_list_album_shape(self):
        song = dict(SONG, album=[{"name": "Album A", "id": "z"}])
        yt = FakeYTMusic([], {"abcd1234": TIMED})
        c = candidate_from_song(yt, song)
        assert c is not None
        self.assertEqual(c["album"], "Album A")


if __name__ == "__main__":
    unittest.main()
