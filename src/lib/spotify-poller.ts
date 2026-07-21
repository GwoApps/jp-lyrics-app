import { getSpotifyTokenForUser } from './spotify';
import { normalizeSpotifyTrack } from './spotify';

export interface NowPlayingData {
  connected: boolean;
  is_playing: boolean;
  progress_ms: number;
  duration_ms: number;
  track: { id: string; uri: string; name: string; artist: string; album: string; cover_url?: string | null } | null;
  error?: number;
}

/** Diff message sent over SSE */
export interface DiffMessage {
  v?: number;
  seq: number;
  c: number;  // checksum of full data
  d: Partial<NowPlayingData>; // changed fields only (empty = no change)
}

type Subscriber = (data: NowPlayingData, diff: DiffMessage) => void;

interface UserPoller {
  subscribers: Map<Subscriber, { lastData: NowPlayingData | null; lastSeq: number }>;
  interval: ReturnType<typeof setInterval> | null;
  lastData: NowPlayingData | null;
  seq: number;
  consecutiveErrors: number;
}

const pollers = new Map<string, UserPoller>();

const POLL_INTERVAL_MS = 2000;
const MAX_CONSECUTIVE_ERRORS = 10;

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

function startPolling(userEmail: string, poller: UserPoller) {
  if (poller.interval) return;

  const tick = async () => {
    if (poller.subscribers.size === 0) {
      stopPolling(userEmail);
      return;
    }

    try {
      const data = await fetchNowPlaying(userEmail);
      poller.seq++;
      const checksum = computeChecksum(data);
      const diff = computeDiff(poller.lastData, data);
      poller.lastData = data;
      poller.consecutiveErrors = 0;

      const diffMsg: DiffMessage = { seq: poller.seq, c: checksum, d: diff };
      poller.subscribers.forEach((state, cb) => {
        cb(data, diffMsg);
        state.lastData = data;
        state.lastSeq = poller.seq;
      });
    } catch {
      poller.consecutiveErrors++;
      if (poller.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        stopPolling(userEmail);
      }
    }
  };

  tick();
  poller.interval = setInterval(tick, POLL_INTERVAL_MS);
}

function stopPolling(userEmail: string) {
  const poller = pollers.get(userEmail);
  if (!poller) return;
  if (poller.interval) {
    clearInterval(poller.interval);
    poller.interval = null;
  }
  if (poller.subscribers.size === 0) {
    pollers.delete(userEmail);
  }
}

/** Subscribe to now-playing updates. Returns unsubscribe function. */
export function subscribe(
  userEmail: string,
  callback: Subscriber,
  opts?: { fullRefresh?: boolean },
): () => void {
  let poller = pollers.get(userEmail);
  if (!poller) {
    poller = { subscribers: new Map(), interval: null, lastData: null, seq: 0, consecutiveErrors: 0 };
    pollers.set(userEmail, poller);
  }

  poller.subscribers.set(callback, { lastData: null, lastSeq: 0 });

  // Send full data immediately if available (always full for first message)
  if (poller.lastData) {
    const fullMsg: DiffMessage = { seq: poller.seq, c: computeChecksum(poller.lastData), d: poller.lastData };
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

export function getPollerStats() {
  let totalSubs = 0;
  pollers.forEach(p => { totalSubs += p.subscribers.size; });
  return { users: pollers.size, totalSubscribers: totalSubs };
}
