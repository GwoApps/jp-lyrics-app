import { getSpotifyTokenForUser } from './spotify';

export interface NowPlayingData {
  connected: boolean;
  is_playing: boolean;
  progress_ms: number;
  duration_ms: number;
  track: { name: string; artist: string; album: string } | null;
  error?: number;
}

type Subscriber = (data: NowPlayingData) => void;

interface UserPoller {
  subscribers: Set<Subscriber>;
  interval: ReturnType<typeof setInterval> | null;
  lastData: NowPlayingData | null;
  consecutiveErrors: number;
}

// Module-level singleton — persists across route invocations in the same process
const pollers = new Map<string, UserPoller>();

const POLL_INTERVAL_MS = 2000;
const MAX_CONSECUTIVE_ERRORS = 10;

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

  return {
    connected: true,
    is_playing: data.is_playing,
    progress_ms: data.progress_ms,
    duration_ms: data.item.duration_ms,
    track: {
      name: data.item.name,
      artist: data.item.artists?.map((a: { name: string }) => a.name).join(', ') || '',
      album: data.item.album?.name || '',
    },
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
      poller.lastData = data;
      poller.consecutiveErrors = 0;
      poller.subscribers.forEach(cb => cb(data));
    } catch {
      poller.consecutiveErrors++;
      if (poller.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        stopPolling(userEmail);
      }
    }
  };

  // First fetch immediately
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
export function subscribe(userEmail: string, callback: Subscriber): () => void {
  let poller = pollers.get(userEmail);
  if (!poller) {
    poller = { subscribers: new Set(), interval: null, lastData: null, consecutiveErrors: 0 };
    pollers.set(userEmail, poller);
  }

  poller.subscribers.add(callback);

  // Send cached data immediately if available
  if (poller.lastData) {
    callback(poller.lastData);
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
