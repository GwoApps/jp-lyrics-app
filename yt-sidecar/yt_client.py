"""
ytmusicapi client construction + the request budget that bounds upstream calls.

`ytmusicapi` is built on `requests`: since 1.11 its default session already
applies a 30s timeout per call — but neither the per-call timeout nor the number
of calls is bounded for a whole ``/v1/search`` (1 search + up to 5
`get_watch_playlist` + 3 `get_lyrics`), so a slow upstream can still blow past
jplrc's 20s provider budget and get cut off client-side.

This module gives the sidecar its own budget:

* one shared, **timeout-pinned** `requests.Session` is injected into every
  ``YTMusic(requests_session=...)`` (no monkey-patching, no global session);
* `Deadline` is a monotonic budget checked *between* upstream calls and folded
  into the per-call timeout, so a stalled socket is abandoned at the deadline
  instead of pinning a worker;
* `UpstreamDeadlineExceeded` is the language-neutral signal the server maps to
  the protocol's `503 temporary_unavailable`.

Budget defaults are sized against the jplrc side
(``src/lib/lyrics-provider/budget.ts``): a *search* must finish before jplrc's
20s default provider budget, and a *manifest / test-connection* — the same
constant payload the server always serves, no upstream call — gets a shorter
one so admin checks answer even while searches are in flight.
"""

import logging
import os
import time
from typing import Any, Callable, Optional, TypeVar

import requests
from requests.adapters import HTTPAdapter

logger = logging.getLogger("yt-sidecar")

# Upper bounds that always beat jplrc's own client-side budgets (20s for
# /v1/search, 15s for the manifest), so the sidecar answers with a diagnosable
# 503 well before jplrc aborts the connection and silently degrades the chain.
SEARCH_DEADLINE_SECONDS = 12.0
MANIFEST_DEADLINE_SECONDS = 6.0
#: Upper bound for the per-upstream-call timeout (a deadline can only shrink it).
MAX_UPSTREAM_TIMEOUT_SECONDS = 30.0
#: TCP connect budget: a dead host must fail fast, before any deadline math.
CONNECT_TIMEOUT_SECONDS = 5.0
#: Pool cap per upstream host; searches run in the threadpool concurrently.
POOL_MAXSIZE = 8
#: Below this the remaining budget cannot plausibly finish a call — stop early.
MIN_CALL_SECONDS = 0.5
#: Slack added to the budget for the request-level guard that aborts a worker
#: which somehow ignored the budget entirely (a wedged socket that never returns
#: from `requests`). Only the container-level ceiling: normal paths are bounded
#: by the deadline far earlier.
WORKER_ABORT_SLACK_SECONDS = 5.0

DEADLINE_ENV = "YT_MUSIC_DEADLINE_SECONDS"
TIMEOUT_ENV = "YT_MUSIC_TIMEOUT_SECONDS"

T = TypeVar("T")


class UpstreamDeadlineExceeded(Exception):
    """The whole-search budget is used up — map to `503 temporary_unavailable`."""

    def __init__(self, seconds: float, stage: str = "upstream"):
        self.seconds = float(seconds)
        self.stage = stage
        super().__init__(f"{stage} deadline of {seconds:g}s exceeded")

    def __reduce__(self):
        return (self.__class__, (self.seconds, self.stage))


def _read_bounded_env(name: str, fallback: float, low: float, high: float) -> float:
    """Parse a positive float env var inside `[low, high]`; else fall back."""
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return fallback
    try:
        value = float(raw)
    except ValueError:
        logger.warning("%s=%r is not numeric; using %gs", name, raw, fallback)
        return fallback
    if not (value > 0) or value < low or value > high:
        logger.warning("%s=%g is out of range [%g, %g]; using %gs", name, value, low, high, fallback)
        return fallback
    return value


def upstream_timeout_seconds() -> float:
    """Per-upstream-call timeout (env-overridable, clamped)."""
    return _read_bounded_env(
        TIMEOUT_ENV, MAX_UPSTREAM_TIMEOUT_SECONDS, 1.0, MAX_UPSTREAM_TIMEOUT_SECONDS
    )


def search_deadline_seconds() -> float:
    """Total budget for one /v1/search, env-overridable and clamped."""
    return _read_bounded_env(DEADLINE_ENV, SEARCH_DEADLINE_SECONDS, 1.0, 60.0)


def manifest_deadline_seconds() -> float:
    """
    Budget for manifest / test-connection handling.

    In this sidecar these answer from the manifest constant and never touch the
    upstream, so the budget is only a guard: it stays below the search budget
    and below jplrc's 15s manifest budget.
    """
    configured = _read_bounded_env(DEADLINE_ENV, MANIFEST_DEADLINE_SECONDS, 1.0, 60.0)
    return min(configured, MANIFEST_DEADLINE_SECONDS)


def manifest_timeout_value() -> Any:
    """
    requests-style timeout tuple/pair for the manifest path, or a float.
    Returned as-is to callers that only need a bound, not an exact shape.
    """
    return (CONNECT_TIMEOUT_SECONDS, manifest_deadline_seconds())


class Deadline:
    """
    One monotonic budget shared by every upstream call of a single request.

    ``check()`` is called between upstream calls (so a long fan-out cannot
    ignore the budget) and ``remaining_timeout()`` shrinks the per-call timeout
    so a stalled socket is abandoned at the deadline instead of pinning the
    request forever. Instance state only — one Deadline per request, never
    shared across threads.
    """

    def __init__(
        self,
        seconds: float,
        stage: str = "upstream",
        clock: Callable[[], float] = time.monotonic,
    ):
        self.total = float(seconds)
        self.stage = stage
        self._clock = clock
        self._start = clock()

    @property
    def elapsed(self) -> float:
        return self._clock() - self._start

    @property
    def remaining(self) -> float:
        return self.total - self.elapsed

    @property
    def expired(self) -> bool:
        return self.remaining <= 0

    def remaining_timeout(self, per_call: float) -> float:
        """
        Effective timeout for the next upstream call: min(per-call, remaining).

        Raises `UpstreamDeadlineExceeded` when the budget is already spent (or
        is below the floor at which a call could still succeed).
        """
        remaining = self.remaining
        if remaining <= MIN_CALL_SECONDS:
            raise UpstreamDeadlineExceeded(self.total, self.stage)
        return max(MIN_CALL_SECONDS, min(float(per_call), remaining))

    def check(self) -> None:
        """Raise when the budget is spent; call between upstream calls."""
        if self.expired:
            raise UpstreamDeadlineExceeded(self.total, self.stage)


class TimeoutSession(requests.Session):
    """
    A `requests.Session` that applies a timeout to every request it sends.

    ytmusicapi calls ``session.get`` / ``session.post`` / ``session.request``
    without a timeout; this subclass fills one in when the caller omitted it (an
    explicit timeout from a caller still wins). One instance is shared by the
    process for connection pooling, so it carries **no** mutable per-request
    state — the deadline stays in the per-request `Deadline`.
    """

    def __init__(self, default_timeout: Optional[float] = None):
        super().__init__()
        self.default_timeout = default_timeout
        # requests' own `Session.request` signature does not admit **kwargs, but
        # ytmusicapi only ever uses the standard keyword arguments.
        self.request = self._timed(super().request)  # type: ignore[method-assign]
        self.get = self._timed(super().get)  # type: ignore[method-assign]
        self.post = self._timed(super().post)  # type: ignore[method-assign]
        adapter = HTTPAdapter(pool_connections=POOL_MAXSIZE, pool_maxsize=POOL_MAXSIZE)
        self.mount("https://", adapter)
        self.mount("http://", adapter)

    def _timed(self, func):
        def wrapper(*args, **kwargs):
            if kwargs.get("timeout") is None:
                kwargs["timeout"] = self.default_timeout or upstream_timeout_seconds()
            return func(*args, **kwargs)

        wrapper.__name__ = getattr(func, "__name__", "request")
        wrapper.__doc__ = getattr(func, "__doc__", None)
        return wrapper


def build_upstream_session(default_timeout: Optional[float] = None) -> TimeoutSession:
    """
    Build the shared upstream session, env-tuned by default.

    ``allow_redirects`` stays at requests' default (ytmusicapi relies on it for
    its own endpoints); what matters here is that *every* call is bounded.
    """
    timeout = float(default_timeout) if default_timeout else upstream_timeout_seconds()
    session = TimeoutSession(default_timeout=timeout)
    return session


def build_ytmusic(oauth_path: Optional[str] = None, session: Optional[requests.Session] = None):
    """
    Create a `YTMusic` bound to the bounded session (lazy import: ytmusicapi is
    a heavy import and is not needed for the protocol tests).
    """
    from ytmusicapi import YTMusic

    upstream = session or build_upstream_session()
    if oauth_path:
        return YTMusic(oauth_path, requests_session=upstream)
    return YTMusic(requests_session=upstream)
