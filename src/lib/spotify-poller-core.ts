import { createTimeoutBudget, isFetchTimeoutError } from './fetch-timeout';
import { MAX_CONSECUTIVE_ERRORS, backoffDelay } from './retry-backoff';
import { SPOTIFY_TIMEOUT_STATUS, isSpotifyTransientError } from './spotify-error';

export interface NowPlayingData {
  connected: boolean;
  is_playing: boolean;
  progress_ms: number;
  duration_ms: number;
  track: { id: string; uri: string; name: string; artist: string; album: string; cover_url?: string | null } | null;
  error?: number;
}

/** Degraded sync state pushed to subscribers during/after consecutive failures. */
export type SyncState = 'connected' | 'retrying' | 'stopped';

/**
 * Changed fields only. `error` is explicitly nullable: JSON drops `undefined`,
 * so "the error went away" has to be sent as `null` — otherwise a client keeps
 * the stale error from the previous message and a recovered sync looks broken.
 */
export type PlaybackDiff = Omit<Partial<NowPlayingData>, 'error'> & { error?: number | null };

/** Diff message sent over SSE */
export interface DiffMessage {
  v?: number;
  seq: number;
  c: number;  // checksum of full data
  d: PlaybackDiff; // changed fields only (empty = no change)
  /** Current sync state — lets clients distinguish degraded pushes from real data. */
  _sync?: SyncState;
  /** Timestamp of the Spotify GET start, separate from checksum-protected playback data. */
  _observedAt?: number;
}

export type Subscriber = (data: NowPlayingData, diff: DiffMessage) => void;

export interface PollerTimers {
  schedule: (run: () => void, delayMs: number) => unknown;
  cancel: (handle: unknown) => void;
}

export interface PollerDependencies {
  /** One upstream observation. `onFetchStart` timestamps the actual Spotify GET. */
  fetchNowPlaying: (userEmail: string, onFetchStart: (at: number) => void) => Promise<NowPlayingData>;
  timers?: PollerTimers;
  pollIntervalMs?: number;
  /**
   * Hard cap for ONE observation. This is the backstop that keeps the poller
   * alive even if a future upstream call forgets its own timeout: nothing in a
   * tick may wait forever, because the next tick is only scheduled after it
   * settles (issue #370).
   */
  observationBudgetMs?: number;
  maxConsecutiveErrors?: number;
  backoff?: (consecutiveErrors: number) => number;
}

export interface PollerStats {
  users: number;
  totalSubscribers: number;
}

export interface SpotifyPoller {
  subscribe: (userEmail: string, callback: Subscriber) => () => void;
  /** Resume a permanently-stopped poller (user action only). No-op otherwise. */
  resumePolling: (userEmail: string) => void;
  getStats: () => PollerStats;
}

const DEFAULT_POLL_INTERVAL_MS = 2000;
/** Token refresh + GET must both fit inside one observation. */
const DEFAULT_OBSERVATION_BUDGET_MS = 8000;

interface UserPoller {
  subscribers: Map<Subscriber, { lastData: NowPlayingData | null; lastSeq: number }>;
  timer: unknown;
  lastData: NowPlayingData | null;
  lastObservedAt: number;
  seq: number;
  consecutiveErrors: number;
  syncState: SyncState;
}

const EMPTY: NowPlayingData = { connected: false, is_playing: false, progress_ms: 0, duration_ms: 0, track: null };

const defaultTimers: PollerTimers = {
  schedule: (run, delayMs) => setTimeout(run, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Fast 32-bit hash for checksum */
function computeChecksum(data: NowPlayingData): number {
  const s = `${data.progress_ms}|${data.is_playing}|${data.track?.id ?? ''}|${data.track?.uri ?? ''}|${data.track?.name ?? ''}|${data.track?.artist ?? ''}|${data.track?.album ?? ''}|${data.track?.cover_url ?? ''}|${data.duration_ms}|${data.connected}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/** Compute diff between two states. Returns only changed fields. */
function computeDiff(prev: NowPlayingData | null, curr: NowPlayingData): PlaybackDiff {
  if (!prev) return curr; // first time: send everything
  const diff: PlaybackDiff = {};
  if (prev.connected !== curr.connected) diff.connected = curr.connected;
  if (prev.is_playing !== curr.is_playing) diff.is_playing = curr.is_playing;
  if (prev.progress_ms !== curr.progress_ms) diff.progress_ms = curr.progress_ms;
  if (prev.duration_ms !== curr.duration_ms) diff.duration_ms = curr.duration_ms;
  // `null` (not `undefined`) so recovery actually clears the client's error code.
  if (prev.error !== curr.error) diff.error = curr.error ?? null;
  if (
    prev.track?.id !== curr.track?.id ||
    prev.track?.uri !== curr.track?.uri ||
    prev.track?.name !== curr.track?.name ||
    prev.track?.artist !== curr.track?.artist ||
    prev.track?.album !== curr.track?.album ||
    prev.track?.cover_url !== curr.track?.cover_url
  ) {
    diff.track = curr.track;
  }
  return diff;
}

/**
 * Build a poller. Dependencies are explicit so a hanging upstream can be
 * injected in tests instead of only being reproducible in production.
 */
export function createSpotifyPoller(deps: PollerDependencies): SpotifyPoller {
  const timers = deps.timers ?? defaultTimers;
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const observationBudgetMs = deps.observationBudgetMs ?? DEFAULT_OBSERVATION_BUDGET_MS;
  const maxErrors = deps.maxConsecutiveErrors ?? MAX_CONSECUTIVE_ERRORS;
  const nextDelay = deps.backoff ?? backoffDelay;
  const pollers = new Map<string, UserPoller>();

  /** Broadcast the current data + diff to all subscribers. */
  function broadcast(poller: UserPoller, data: NowPlayingData, observedAt: number) {
    poller.seq++;
    const checksum = computeChecksum(data);
    const diff = computeDiff(poller.lastData, data);
    poller.lastData = data;
    poller.lastObservedAt = observedAt;

    const diffMsg: DiffMessage = { seq: poller.seq, c: checksum, d: diff, _sync: poller.syncState, _observedAt: observedAt };
    poller.subscribers.forEach((state, cb) => {
      try {
        cb(data, diffMsg);
      } catch {
        // One broken subscriber (e.g. an SSE controller already closed) must not
        // take down the broadcast for everyone else, nor abort the tick.
      }
      state.lastData = data;
      state.lastSeq = poller.seq;
    });
  }

  /** Push a degraded-state notification to subscribers (keeps last-known playback data). */
  function notifyDegraded(poller: UserPoller) {
    const data = poller.lastData ?? EMPTY;
    broadcast(poller, data, poller.lastObservedAt);
  }

  /**
   * Degraded notification that also carries the reason. The last known playback
   * is kept (a stalled upstream produced no new observation, so dropping the
   * track would make the UI claim "nothing is playing" — a different lie).
   */
  function notifyDegradedWithError(poller: UserPoller, error: number) {
    const data: NowPlayingData = { ...(poller.lastData ?? EMPTY), error };
    broadcast(poller, data, poller.lastObservedAt);
  }

  /**
   * Run one observation under a hard budget. A hung upstream is turned into a
   * `FetchTimeoutError` instead of a promise that never settles — that is what
   * lets `tick()` reach its `finally` and schedule the next round.
   */
  async function observe(userEmail: string, onFetchStart: (at: number) => void): Promise<NowPlayingData> {
    const budget = createTimeoutBudget(observationBudgetMs);
    try {
      return await Promise.race([
        deps.fetchNowPlaying(userEmail, onFetchStart),
        budget.deadline,
      ]);
    } finally {
      budget.dispose();
    }
  }

  function scheduleTick(userEmail: string, poller: UserPoller, delayMs: number) {
    if (poller.timer !== null) {
      timers.cancel(poller.timer);
      poller.timer = null;
    }
    poller.timer = timers.schedule(() => { void tick(userEmail, poller); }, delayMs);
  }

  function stopPolling(userEmail: string, poller: UserPoller) {
    if (poller.timer !== null) {
      timers.cancel(poller.timer);
      poller.timer = null;
    }
    if (poller.subscribers.size === 0 && pollers.get(userEmail) === poller) {
      pollers.delete(userEmail);
    }
  }

  async function tick(userEmail: string, poller: UserPoller) {
    if (poller.subscribers.size === 0) {
      stopPolling(userEmail, poller);
      return;
    }

    let observedAt = 0;
    // null = do not reschedule (the poller stopped on purpose).
    let nextDelayMs: number | null = pollIntervalMs;
    try {
      const data = await observe(userEmail, at => { observedAt = at; });
      // Transient Spotify fault (429/5xx): back off but NEVER count toward the
      // fatal-error stop — these auto-recover without user action. This prevents
      // a brief Spotify outage from permanently stopping sync (issue #117).
      if (data.error && isSpotifyTransientError(data.error)) {
        poller.consecutiveErrors = 0;
        poller.syncState = 'retrying';
        broadcast(poller, data, observedAt);
        nextDelayMs = nextDelay(1);
      } else {
        // Success → reset failure counter, restore normal cadence.
        poller.consecutiveErrors = 0;
        poller.syncState = 'connected';
        broadcast(poller, data, observedAt);
      }
    } catch (error) {
      if (isFetchTimeoutError(error)) {
        // An upstream that never answered is a transient fault, not a verdict
        // that sync is broken: back off and keep polling, and tell subscribers
        // why (issue #370). The timeout is deliberately NOT counted toward the
        // fatal-error stop, for the same reason 429/5xx are not (issue #117).
        poller.consecutiveErrors = 0;
        poller.syncState = 'retrying';
        notifyDegradedWithError(poller, SPOTIFY_TIMEOUT_STATUS);
        nextDelayMs = nextDelay(1);
      } else {
        poller.consecutiveErrors++;
        if (poller.consecutiveErrors >= maxErrors) {
          // Permanently stop — sync can only resume via user action (resumePolling).
          poller.syncState = 'stopped';
          notifyDegraded(poller);
          nextDelayMs = null;
        } else {
          poller.syncState = 'retrying';
          notifyDegraded(poller);
          nextDelayMs = nextDelay(poller.consecutiveErrors);
        }
      }
    } finally {
      // The next round is ALWAYS scheduled from here, so no failure mode can
      // leave the poller without a timer (issue #370).
      if (nextDelayMs === null) stopPolling(userEmail, poller);
      else if (poller.subscribers.size === 0) stopPolling(userEmail, poller);
      else scheduleTick(userEmail, poller, nextDelayMs);
    }
  }

  function startPolling(userEmail: string, poller: UserPoller) {
    if (poller.timer !== null) return;
    // Once stopped, polling can only resume via manual user action (resumePolling).
    if (poller.syncState === 'stopped') return;
    scheduleTick(userEmail, poller, 0);
  }

  function subscribe(userEmail: string, callback: Subscriber): () => void {
    let poller = pollers.get(userEmail);
    if (!poller) {
      poller = {
        subscribers: new Map(), timer: null, lastData: null, lastObservedAt: 0,
        seq: 0, consecutiveErrors: 0, syncState: 'connected',
      };
      pollers.set(userEmail, poller);
    }

    poller.subscribers.set(callback, { lastData: null, lastSeq: 0 });

    // Send full data immediately if available (always full for first message)
    if (poller.lastData) {
      const fullMsg: DiffMessage = {
        seq: poller.seq, c: computeChecksum(poller.lastData), d: poller.lastData,
        _sync: poller.syncState, _observedAt: poller.lastObservedAt,
      };
      try {
        callback(poller.lastData, fullMsg);
      } catch { /* a failing subscriber must not break subscribe */ }
      const state = poller.subscribers.get(callback);
      if (state) { state.lastData = poller.lastData; state.lastSeq = poller.seq; }
    }

    startPolling(userEmail, poller);

    return () => {
      poller!.subscribers.delete(callback);
      if (poller!.subscribers.size === 0) stopPolling(userEmail, poller!);
    };
  }

  function resumePolling(userEmail: string) {
    const poller = pollers.get(userEmail);
    if (!poller) return;
    poller.consecutiveErrors = 0;
    poller.syncState = 'connected';
    startPolling(userEmail, poller);
  }

  function getStats(): PollerStats {
    let totalSubscribers = 0;
    pollers.forEach(poller => { totalSubscribers += poller.subscribers.size; });
    return { users: pollers.size, totalSubscribers };
  }

  return { subscribe, resumePolling, getStats };
}
