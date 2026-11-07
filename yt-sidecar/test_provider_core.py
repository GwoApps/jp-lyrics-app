"""
Unit tests for provider_core.py (stdlib only, no ytmusicapi/fastapi needed):

    python3 -m unittest discover -s yt-sidecar

Fake upstreams duck-type the two ytmusicapi calls the plugin makes:
`search(query, filter=..., limit=...)` and `get_watch_playlist(videoId=...)` /
`get_lyrics(browse_id, timestamps=True)`.

The budget tests drive `provider_core` with a fake monotonic clock and a
scripted `yt_client.UpstreamDeadlineExceeded`, so "upstream hangs" cases assert a
*bounded* stop (the deadline error the server maps to 503) without sleeping.
"""

import threading
import unittest

from provider_core import (
    MAX_LYRICS_FETCHES,
    PROBE_QUERY,
    PROVIDER_ID,
    EmptySearchGuard,
    UpstreamHealthProbe,
    bearer_ok,
    build_query,
    candidate_from_song,
    lyric_lines_to_texts,
    lyrics_payload_to_texts,
    manifest,
    ms_to_lrc,
    probe_upstream,
    register_deadline_exception,
    search_candidates,
)
from yt_client import (
    Deadline,
    TimeoutSession,
    UpstreamDeadlineExceeded,
    build_upstream_session,
    manifest_deadline_seconds,
    search_deadline_seconds,
)

# The server registers this at import time; do it here too so the tests exercise
# the same wiring without importing FastAPI.
register_deadline_exception(UpstreamDeadlineExceeded)


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
        #: Extra keyword arguments the adapter methods received (budget plumbing).
        self.search_kwargs = []
        self.watch_kwargs = []
        self.lyrics_kwargs = []

    def search(self, query, filter=None, limit=None, **kwargs):
        self.search_queries.append({"query": query, "filter": filter, "limit": limit})
        self.search_kwargs.append(kwargs)
        return self._results()

    def search_error(self, error):
        """Make the next `search` raise (upstream 5xx, broken session, …)."""
        self.songs = error
        return self

    def _results(self):
        if isinstance(self.songs, Exception):
            raise self.songs
        return self.songs

    def get_watch_playlist(self, videoId=None, **kwargs):
        self.watch_calls.append(videoId)
        self.watch_kwargs.append(kwargs)
        if videoId in self.watch_missing:
            return {"tracks": [], "playlistId": None, "lyrics": None, "related": None}
        return {"tracks": [], "playlistId": None, "lyrics": f"MPLYt_{videoId}", "related": None}

    def get_lyrics(self, browseId, timestamps=False, **kwargs):
        self.lyrics_calls.append(browseId)
        self.lyrics_kwargs.append(kwargs)
        video_id = browseId.removeprefix("MPLYt_")
        payload = self.lyrics_by_video.get(video_id)
        if isinstance(payload, Exception):
            raise payload
        return payload


class SlowYTMusic(FakeYTMusic):
    """
    Upstream that *fails to stop*: every call consumes `cost_per_call` seconds of
    a shared fake clock and reports it as a socket timeout (the real shape of a
    stalled upstream: the bounded session raises `requests` timeouts, which
    ytmusicapi does not swallow).
    """

    def __init__(self, songs, lyrics_by_video=None, clock=None, cost_per_call=1.0):
        super().__init__(songs, lyrics_by_video)
        self.clock = clock
        self.cost_per_call = cost_per_call
        self.calls = 0

    def _charge(self):
        self.calls += 1
        if self.clock is not None:
            self.clock.advance(self.cost_per_call)

    def search(self, query, filter=None, limit=None, **kwargs):
        self._charge()
        raise UpstreamDeadlineExceeded(1.0, "upstream")

    def get_watch_playlist(self, videoId=None, **kwargs):
        self._charge()
        raise UpstreamDeadlineExceeded(1.0, "upstream")

    def get_lyrics(self, browseId, timestamps=False, **kwargs):
        self._charge()
        raise UpstreamDeadlineExceeded(1.0, "upstream")


class FakeClock:
    """Monotonic clock the tests advance by hand (no sleeps)."""

    def __init__(self, start=0.0):
        self.now = float(start)

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += float(seconds)


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


class TestAuth(unittest.TestCase):
    def test_no_token_disables_auth(self):
        self.assertTrue(bearer_ok(None, None))
        self.assertTrue(bearer_ok(None, ""))
        self.assertTrue(bearer_ok("Bearer whatever", None))

    def test_token_requires_exact_bearer_header(self):
        self.assertTrue(bearer_ok("Bearer s3cret", "s3cret"))
        self.assertFalse(bearer_ok(None, "s3cret"))
        self.assertFalse(bearer_ok("", "s3cret"))
        self.assertFalse(bearer_ok("Bearer wrong", "s3cret"))
        self.assertFalse(bearer_ok("bearer s3cret", "s3cret"))
        self.assertFalse(bearer_ok("s3cret", "s3cret"))


class TestUpstreamProbe(unittest.TestCase):
    def probe(self, yt):
        return lambda: probe_upstream(yt)

    def test_non_empty_result_set_is_healthy(self):
        yt = FakeYTMusic([SONG])
        self.assertTrue(probe_upstream(yt))
        self.assertEqual(yt.search_queries[0], {"query": PROBE_QUERY, "filter": "songs", "limit": 1})

    def test_empty_result_set_is_a_failure(self):
        # Soft-throttled sessions answer 200 with no results and no error: this
        # is the degradation the probe exists to catch, so it must not read ok.
        self.assertFalse(probe_upstream(FakeYTMusic([])))

    def test_probe_result_is_cached_for_the_ttl(self):
        yt = FakeYTMusic([SONG])
        calls = []

        def probe():
            calls.append(1)
            return probe_upstream(yt)

        p = UpstreamHealthProbe(probe, ttl_s=60.0)
        self.assertTrue(p.check(now=1000.0))
        self.assertTrue(p.check(now=1059.9))  # inside the TTL: served from cache
        self.assertEqual(len(calls), 1)
        p.check(now=1060.0)                   # TTL lapsed: probe again
        self.assertEqual(len(calls), 2)

    def test_a_later_probe_overrides_a_cached_success(self):
        yt = FakeYTMusic([SONG])
        probe = UpstreamHealthProbe(self.probe(yt), ttl_s=60.0)
        self.assertTrue(probe.check(now=0.0))
        yt.songs = []                         # upstream starts returning nothing
        self.assertFalse(probe.check(now=61.0))

    def test_upstream_exception_and_cache_reset(self):
        broken = FakeYTMusic([]).search_error(RuntimeError("upstream 500"))
        probe = UpstreamHealthProbe(self.probe(broken), ttl_s=30.0)
        self.assertFalse(probe.check(now=0.0))
        broken.songs = [SONG]                 # session recovers
        self.assertTrue(probe.check(now=30.0))

    def test_zero_ttl_always_probes(self):
        calls = []
        probe = UpstreamHealthProbe(lambda: calls.append(1) or True, ttl_s=0.0)
        probe.check(now=0.0)
        probe.check(now=0.0)
        self.assertEqual(len(calls), 2)


class TestEmptySearchGuard(unittest.TestCase):
    def test_hits_reset_the_streak(self):
        g = EmptySearchGuard(threshold=2)
        self.assertFalse(g.observe(0))  # streak 1
        self.assertFalse(g.observe(2))  # a hit resets
        self.assertFalse(g.observe(0))  # streak 1 again, not 2
        self.assertTrue(g.observe(0))   # streak 2 -> recycle
        self.assertFalse(g.observe(3))  # a hit resets after recycle

    def test_threshold_consecutive_empty_triggers_once(self):
        g = EmptySearchGuard(threshold=2)
        self.assertFalse(g.observe(0))
        self.assertTrue(g.observe(0))
        # streak restarted: the next empty starts counting again
        self.assertFalse(g.observe(0))
        self.assertTrue(g.observe(0))

    def test_threshold_is_clamped_to_at_least_one(self):
        g = EmptySearchGuard(threshold=0)
        self.assertEqual(g.threshold, 1)
        self.assertTrue(g.observe(0))


class TestUpstreamBudget(unittest.TestCase):
    """
    The budget half of ISSUE #353: a stalled upstream must end the search with a
    deadline error (the server maps it to a diagnosable `503
    temporary_unavailable`) instead of pinning the request until some outer
    timeout cuts the connection — and it must stop *before* jplrc's 20s budget.
    """

    def test_search_budget_stays_under_the_jplrc_provider_budget(self):
        # jplrc defaults: 20s per /v1/search, 15s for manifest/test-connection.
        self.assertLess(search_deadline_seconds(), 20.0)
        self.assertLess(manifest_deadline_seconds(), 15.0)

    def test_stalled_upstream_raises_instead_of_hanging(self):
        clock = FakeClock()
        deadline = Deadline(search_deadline_seconds(), stage="search", clock=clock)
        yt = SlowYTMusic([SONG], {"abcd1234": TIMED}, clock=clock)
        with self.assertRaises(UpstreamDeadlineExceeded):
            search_candidates(yt, {"title": "t", "artists": ["a"]}, deadline=deadline)

    def test_budget_is_checked_between_songs_so_a_fanout_cannot_ignore_it(self):
        """Every song reports an upstream timeout; the budget still stops the scan."""
        clock = FakeClock()
        deadline = Deadline(search_deadline_seconds(), stage="search", clock=clock)
        # A stub whose calls are free but whose clock jumps only via `advance`,
        # driven per call — the deadline must be re-checked between songs.
        songs = [dict(SONG, videoId=f"v{i}", title=f"s{i}") for i in range(5)]

        class PerCallStall(FakeYTMusic):
            def search(self, query, filter=None, limit=None, **kwargs):
                return songs

            def get_watch_playlist(self, videoId=None, **kwargs):
                clock.advance(search_deadline_seconds() / 2 + 1)
                raise UpstreamDeadlineExceeded(search_deadline_seconds(), "upstream")

        yt = PerCallStall(songs)
        with self.assertRaises(UpstreamDeadlineExceeded):
            search_candidates(yt, {"title": "t", "artists": ["a"]}, deadline=deadline)
        self.assertLess(len(yt.watch_calls), len(songs))

    def test_deadline_error_is_never_swallowed_as_a_per_song_miss(self):
        """
        A spent budget must not look like "this song has no lyrics".

        Regression guard: `candidate_from_song` soft-skips per-song failures, and
        a naive `except Exception: return None` there turned a bounded stop into a
        misleading `200 {"candidates": []}` instead of the protocol's 503.
        """
        yt = FakeYTMusic([SONG], {"abcd1234": TIMED})

        def stalled_watch(videoId=None, **kwargs):
            raise UpstreamDeadlineExceeded(search_deadline_seconds(), "upstream")

        yt.get_watch_playlist = stalled_watch
        with self.assertRaises(UpstreamDeadlineExceeded):
            candidate_from_song(yt, SONG)

    def test_deadline_error_from_search_propagates_out_of_the_scan(self):
        clock = FakeClock()
        deadline = Deadline(search_deadline_seconds(), stage="search", clock=clock)
        yt = SlowYTMusic([SONG], {"abcd1234": RuntimeError("boom")}, clock=clock)
        with self.assertRaises(UpstreamDeadlineExceeded):
            search_candidates(yt, {"title": "t", "artists": ["a"]}, deadline=deadline)

    def test_ordinary_per_song_failure_still_only_skips_that_song(self):
        """The soft-skip contract is unchanged for non-budget failures."""
        broken = dict(SONG, videoId="bad1")
        yt = FakeYTMusic([broken, SONG], {"bad1": RuntimeError("boom"), "abcd1234": TIMED})
        candidates = search_candidates(
            yt,
            {"title": "t", "artists": ["a"]},
            deadline=Deadline(30.0, stage="search", clock=FakeClock()),
        )
        self.assertEqual([c["title"] for c in candidates], [SONG["title"]])

    def test_expired_budget_fails_before_any_upstream_call(self):
        clock = FakeClock()
        deadline = Deadline(1.0, stage="search", clock=clock)
        clock.advance(5.0)
        yt = FakeYTMusic([SONG], {"abcd1234": TIMED})
        with self.assertRaises(UpstreamDeadlineExceeded):
            search_candidates(yt, {"title": "t", "artists": ["a"]}, deadline=deadline)
        self.assertEqual(yt.search_queries, [])
        self.assertEqual(yt.watch_calls, [])

    def test_remaining_budget_shrinks_the_per_call_timeout(self):
        clock = FakeClock()
        deadline = Deadline(10.0, stage="search", clock=clock)
        self.assertEqual(deadline.remaining_timeout(30.0), 10.0)
        clock.advance(7.0)
        self.assertEqual(deadline.remaining_timeout(30.0), 3.0)
        clock.advance(3.5)
        # Below the floor a call cannot plausibly succeed -> stop rather than wait.
        with self.assertRaises(UpstreamDeadlineExceeded):
            deadline.remaining_timeout(30.0)

    def test_no_deadline_keeps_the_original_behaviour(self):
        yt = FakeYTMusic([SONG], {"abcd1234": TIMED})
        candidates = search_candidates(yt, {"title": "t", "artists": ["a"]})
        self.assertEqual(len(candidates), 1)
        self.assertEqual(yt.search_kwargs, [{}])
        self.assertEqual(yt.watch_kwargs, [{}])
        self.assertEqual(yt.lyrics_kwargs, [{}])


class TestTimeoutSession(unittest.TestCase):
    """
    Every upstream call must carry a timeout: ytmusicapi calls `session.get` /
    `session.post` without one, and requests' default is "no timeout".

    These drive the *real* `requests.Session.request` path with a stub adapter
    (`Session.send` replaced), so the wrappers around `request`/`get`/`post` are
    the thing under test — no network, no monkey-patching of the wrappers.
    """

    class _RecordingAdapter:
        """Stub transport: records the keyword arguments requests hands it."""

        def __init__(self):
            self.calls = []

        def send(self, request, **kwargs):
            self.calls.append(kwargs)
            import requests

            response = requests.Response()
            response.status_code = 200
            response.url = request.url
            return response

        def close(self):  # requests calls this on GC / session.close()
            pass

    def _session_with_recorder(self, default_timeout):
        """A real TimeoutSession whose transport records instead of connecting."""
        session = TimeoutSession(default_timeout=default_timeout)
        adapter = self._RecordingAdapter()
        session.adapters.clear()
        session.mount("https://", adapter)
        session.mount("http://", adapter)
        return session, adapter, None

    def test_vanilla_session_leaves_timeout_unset(self):
        """Premise check: without the wrapper the call carries no bound at all."""
        import requests

        plain = requests.Session()
        rec = self._RecordingAdapter()
        plain.adapters.clear()
        plain.mount("https://", rec)
        plain.mount("http://", rec)
        plain.request("GET", "https://example.invalid")
        self.assertIsNone(rec.calls[0]["timeout"])

    def test_session_fills_in_a_default_timeout(self):
        session, adapter, _ = self._session_with_recorder(4.0)
        session.request("GET", "https://example.invalid", timeout=None)
        self.assertEqual(adapter.calls[0]["timeout"], 4.0)

    def test_get_and_post_wrappers_apply_the_timeout(self):
        session, adapter, _ = self._session_with_recorder(2.5)
        session.get("https://example.invalid", timeout=None)
        session.post("https://example.invalid", timeout=None)
        self.assertEqual([c["timeout"] for c in adapter.calls], [2.5, 2.5])

    def test_explicit_caller_timeout_is_preserved(self):
        session, adapter, _ = self._session_with_recorder(4.0)
        session.request("GET", "https://example.invalid", timeout=1.25)
        self.assertEqual(adapter.calls[0]["timeout"], 1.25)

    def test_timeout_session_is_a_requests_session(self):
        import requests

        self.assertIsInstance(TimeoutSession(default_timeout=1.0), requests.Session)

    def test_build_upstream_session_uses_the_env_tuned_default(self):
        session = build_upstream_session()
        self.assertIsInstance(session, TimeoutSession)
        self.assertGreater(session.default_timeout, 0)

    def test_build_upstream_session_honours_an_explicit_default(self):
        self.assertEqual(build_upstream_session(default_timeout=3.5).default_timeout, 3.5)


class TestSearchConcurrency(unittest.TestCase):
    """
    ISSUE #353 constraint: moving the blocking work off the event loop makes the
    shared client and the empty-search guard concurrent — neither may rely on
    unguarded mutable state.
    """

    def test_empty_search_guard_observe_is_atomic_across_threads(self):
        guard = EmptySearchGuard(threshold=2)
        barrier = threading.Barrier(16)
        recycles = []
        lock = threading.Lock()

        def worker():
            barrier.wait()
            for _ in range(50):
                recycle = guard.observe(0)
                if recycle:
                    with lock:
                        recycles.append(recycle)

        threads = [threading.Thread(target=worker) for _ in range(16)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        # 16 threads x 50 empty observations = 800, i.e. exactly 400 recycle
        # events for a threshold of 2 — no lost updates, no double counts.
        self.assertEqual(sum(recycles), 400)
        self.assertFalse(guard.observe(1))  # a hit still resets the streak

    def test_concurrent_searches_share_one_client_per_request(self):
        """Concurrent scans use one shared client without corrupting the scan."""
        yt = FakeYTMusic([SONG], {"abcd1234": TIMED})
        results = []
        lock = threading.Lock()

        def worker():
            out = search_candidates(yt, {"title": "t", "artists": ["a"]})
            with lock:
                results.append(out)

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(len(results), 8)
        for candidates in results:
            self.assertEqual(len(candidates), 1)
            self.assertEqual(candidates[0]["title"], SONG["title"])

    def test_manifest_endpoint_is_budgeted_below_the_search_budget(self):
        self.assertLessEqual(manifest_deadline_seconds(), search_deadline_seconds())


if __name__ == "__main__":
    unittest.main()
