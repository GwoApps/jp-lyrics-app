import { getSpotifyTokenForUser } from './spotify';
import { normalizeSpotifyTrack } from './spotify';
import { MAX_CONSECUTIVE_ERRORS, backoffDelay } from './retry-backoff';
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

/** Diff message sent over SSE */
export interface DiffMessage {
  v?: number;
  seq: number;
  c: number;  // checksum of full data
  d: Partial<NowPlayingData>; // changed fields only (empty = no change)
  /** Current sync state — lets clients distinguish degraded pushes from real data. */
  _sync?: SyncState;
}

type Subscriber = (data: NowPlayingData, diff: DiffMessage) => void;

interface UserPoller {
  subscribers: Map<Subscriber, { lastData: NowPlayingData | null; lastSeq: number }>;
  timer: ReturnType<typeof setTimeout> | null;
  lastData: NowPlayingData | null;
  seq: number;
  consecutiveErrors: number;
  syncState: SyncState;
}

const pollers = new Map<string, UserPoller>();

const POLL_INTERVAL_MS = 2000;

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
function computeDiff(prev: NowPlayingData | null, curr: NowPlayingData): Partial<NowPlayingData> {
  if (!prev) return curr; // first time: send everything
  const diff: Partial<NowPlayingData> = {};
  if (prev.connected !== curr.connected) diff.connected = curr.connected;
  if (prev.is_playing !== curr.is_playing) diff.is_playing = curr.is_playing;
  if (prev.progress_ms !== curr.progress_ms) diff.progress_ms = curr.progress_ms;
  if (prev.duration_ms !== curr.duration_ms) diff.duration_ms = curr.duration_ms;
  if (prev.error !== curr.error) diff.error = curr.error;
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

/** Broadcast the current data + diff to all subscribers. */
function broadcast(poller: UserPoller, data: NowPlayingData) {
  poller.seq++;
  const checksum = computeChecksum(data);
  const diff = computeDiff(poller.lastData, data);
  poller.lastData = data;

  const diffMsg: DiffMessage = { seq: poller.seq, c: checksum, d: diff, _sync: poller.syncState };
  poller.subscribers.forEach((state, cb) => {
    cb(data, diffMsg);
    state.lastData = data;
    state.lastSeq = poller.seq;
  });
}

/** Push a degraded-state notification to subscribers (keeps last-known playback data). */
function notifyDegraded(poller: UserPoller) {
  const data = poller.lastData ?? { connected: false, is_playing: false, progress_ms: 0, duration_ms: 0, track: null };
  broadcast(poller, data);
}

async function fetchNowPlaying(userEmail: string): Promise<NowPlayingData> {
  const accessToken = await getSpotifyTokenForUser(userEmail);
  if (!accessToken) return { connected: false, is_playing: false, progress_ms: 0, duration_ms: 0, track: null };

  const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 204 || res.status === 202) {
    return { connected: true, is_playing: false, progress_ms: 0, duration_ms: 0, track: null };
  }
  if (!res.ok) {
    return { connected: true, is_playing: false, progress_ms: 0, duration_ms: 0, track: null, error: res.status };
  }

  const data = await res.json();
  if (!data?.item) {
    return { connected: true, is_playing: false, progress_ms: 0, duration_ms: 0, track: null };
  }

  const track = normalizeSpotifyTrack(data.item);

  return {
    connected: true,
    is_playing: data.is_playing,
    progress_ms: data.progress_ms,
    duration_ms: data.item.duration_ms,
    track: track ? {
      id: track.id,
      uri: track.uri,
      name: track.title,
      artist: track.artist,
      album: track.album,
      cover_url: track.coverUrl,
    } : null,
  };
}

/**
 * Schedule the next poll. Uses `setTimeout` so we can support backoff delays
 * up to 6s in addition to the normal 2s cadence.
 */
function scheduleTick(userEmail: string, poller: UserPoller, delayMs: number) {
  if (poller.timer) {
    clearTimeout(poller.timer);
    poller.timer = null;
  }
  poller.timer = setTimeout(() => { void tick(userEmail, poller); }, delayMs);
}

async function tick(userEmail: string, poller: UserPoller) {
  if (poller.subscribers.size === 0) {
    stopPolling(userEmail);
    return;
  }

  try {
    const data = await fetchNowPlaying(userEmail);
    // Success → reset failure counter, restore normal cadence.
    poller.consecutiveErrors = 0;
    if (poller.syncState !== 'connected') poller.syncState = 'connected';
    broadcast(poller, data);
    scheduleTick(userEmail, poller, POLL_INTERVAL_MS);
  } catch {
    poller.consecutiveErrors++;
    if (poller.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      // Permanently stop — sync can only resume via user action (resumeSync).
      poller.syncState = 'stopped';
      notifyDegraded(poller);
      stopPolling(userEmail);
      return;
    }
    // Exponential backoff, capped at 6s.
    poller.syncState = 'retrying';
    notifyDegraded(poller);
    scheduleTick(userEmail, poller, backoffDelay(poller.consecutiveErrors));
  }
}

function startPolling(userEmail: string, poller: UserPoller) {
  if (poller.timer) return;
  // Once stopped, polling can only resume via manual user action (resumePolling).
  if (poller.syncState === 'stopped') return;
  scheduleTick(userEmail, poller, 0);
}

function stopPolling(userEmail: string) {
  const poller = pollers.get(userEmail);
  if (!poller) return;
  if (poller.timer) {
    clearTimeout(poller.timer);
    poller.timer = null;
  }
  if (poller.subscribers.size === 0) {
    pollers.delete(userEmail);
  }
}

/** Subscribe to now-playing updates. Returns unsubscribe function. */
export function subscribe(
  userEmail: string,
  callback: Subscriber,
): () => void {
  let poller = pollers.get(userEmail);
  if (!poller) {
    poller = { subscribers: new Map(), timer: null, lastData: null, seq: 0, consecutiveErrors: 0, syncState: 'connected' };
    pollers.set(userEmail, poller);
  }

  poller.subscribers.set(callback, { lastData: null, lastSeq: 0 });

  // Send full data immediately if available (always full for first message)
  if (poller.lastData) {
    const fullMsg: DiffMessage = { seq: poller.seq, c: computeChecksum(poller.lastData), d: poller.lastData, _sync: poller.syncState };
    callback(poller.lastData, fullMsg);
    const state = poller.subscribers.get(callback);
    if (state) { state.lastData = poller.lastData; state.lastSeq = poller.seq; }
  }

  startPolling(userEmail, poller);

  return () => {
    poller!.subscribers.delete(callback);
    if (poller!.subscribers.size === 0) {
      stopPolling(userEmail);
    }
  };
}

/**
 * Manually resume a permanently-stopped poller (user action only).
 * No-op unless the poller is actually stopped.
 */
export function resumePolling(userEmail: string) {
  const poller = pollers.get(userEmail);
  if (!poller) return;
  poller.consecutiveErrors = 0;
  if (poller.syncState !== 'connected') poller.syncState = 'connected';
  startPolling(userEmail, poller);
}

export function getPollerStats() {
  let totalSubs = 0;
  pollers.forEach(p => { totalSubs += p.subscribers.size; });
  return { users: pollers.size, totalSubscribers: totalSubs };
}
