import { artistKey, type ArtistProfile } from './artists.ts';

interface MetadataSong { spotify_track_id?: string | null }
interface MetadataOptions {
  fetch?: typeof fetch;
  now?: () => number;
  getAccessToken?: (email: string) => Promise<string | null>;
  maxEntries?: number;
  successTtlMs?: number;
  failureTtlMs?: number;
  timeoutMs?: number;
}

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const neutral = (name: string): ArtistProfile => ({ name: name.trim(), imageUrl: null, description: null, genres: [], source: null, sourceUrl: null });
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9]{1,64}$/.test(value);

function safeUrl(value: unknown, hosts: string[], pathPrefix: string): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && hosts.includes(url.hostname) && url.pathname.startsWith(pathPrefix) ? url.href : null;
  } catch { return null; }
}

/** Public metadata only: caches never contain a user, token, or local-library rows. */
export function createArtistMetadataResolver(options: MetadataOptions = {}) {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const limit = Math.max(1, options.maxEntries ?? 256);
  const successTtl = options.successTtlMs ?? 6 * 60 * 60 * 1000;
  const failureTtl = options.failureTtlMs ?? 60 * 1000;
  const timeout = options.timeoutMs ?? 3500;
  const cache = new Map<string, { value: unknown; expires: number }>();
  const pending = new Map<string, Promise<unknown>>();
  // Only transient failure state is user-scoped; public success cache never
  // stores credentials or local-library rows, and one bad token cannot poison it.
  const spotifyCooldowns = new Map<string, number>();
  function coolDown(email: string, error: unknown) {
    const retry = object(error).retryAfterMs;
    const duration = Math.max(failureTtl, typeof retry === 'number' && Number.isFinite(retry) ? retry : 0);
    const until = Math.max(spotifyCooldowns.get(email) ?? 0, now() + duration);
    spotifyCooldowns.delete(email);
    while (spotifyCooldowns.size >= limit) spotifyCooldowns.delete(spotifyCooldowns.keys().next().value!);
    spotifyCooldowns.set(email, until);
  }

  async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(controller.signal),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('artist_metadata_timeout')); }, timeout); }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  }

  async function json(url: string, token?: string): Promise<JsonObject> {
    return bounded(async (signal) => {
      const response = await fetcher(url, {
        signal, cache: 'no-store', redirect: 'error',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        const retryAfter = response.status === 429 ? response.headers.get('Retry-After') : null;
        const seconds = retryAfter !== null && /^\d+(?:\.\d+)?$/.test(retryAfter.trim()) ? Number(retryAfter) * 1000 : NaN;
        const delay = Number.isFinite(seconds) ? seconds : retryAfter ? Date.parse(retryAfter) - now() : 0;
        throw Object.assign(new Error('artist_metadata_unavailable'), { retryAfterMs: Math.max(0, Number.isFinite(delay) ? delay : 0) });
      }
      return object(await response.json());
    });
  }

  async function memo<T>(key: string, load: () => Promise<T>, ttl: (value: T) => number): Promise<T | undefined> {
    const entry = cache.get(key);
    if (entry && entry.expires > now()) {
      cache.delete(key); cache.set(key, entry);
      return entry.value as T;
    }
    cache.delete(key);
    const running = pending.get(key);
    if (running) return running as Promise<T>;
    if (pending.size >= limit) return undefined;
    const job = (async () => {
      const value = await load();
      const duration = ttl(value);
      if (duration > 0) {
        while (cache.size >= limit) cache.delete(cache.keys().next().value!);
        cache.set(key, { value, expires: now() + duration });
      }
      return value;
    })();
    pending.set(key, job);
    try { return await job; } finally { pending.delete(key); }
  }

  async function deezer(name: string): Promise<ArtistProfile> {
    return await memo(`deezer:${artistKey(name)}`, async () => {
      try {
        const body = await json(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name.trim())}&limit=25`);
        // An incomplete result page cannot establish that an exact name is unique.
        if (body.next) return neutral(name);
        const exact = new Map<number, JsonObject>();
        for (const item of array(body.data)) {
          const candidate = object(item);
          if (typeof candidate.name === 'string' && artistKey(candidate.name) === artistKey(name)
            && typeof candidate.id === 'number' && Number.isSafeInteger(candidate.id) && candidate.id > 0) {
            exact.set(candidate.id, candidate);
          }
        }
        // Fan counts are not identity evidence. Never guess between namesakes.
        if (exact.size !== 1) return neutral(name);
        const candidate = [...exact.values()][0];
        const path = `/artist/${candidate.id}`;
        const sourceUrl = safeUrl(candidate.link, ['www.deezer.com', 'deezer.com'], path);
        const image = [candidate.picture_xl, candidate.picture_big, candidate.picture_medium]
          .map((url) => safeUrl(url, ['cdn-images.dzcdn.net', 'cdns-images.dzcdn.net'], '/images/artist/')).find(Boolean) ?? null;
        return {
          name: String(candidate.name).trim(), imageUrl: image, description: null, genres: [], source: 'Deezer',
          sourceUrl: sourceUrl && new URL(sourceUrl).pathname === path ? sourceUrl : null,
        };
      } catch { return neutral(name); }
    }, (profile) => profile.source ? successTtl : failureTtl) ?? neutral(name);
  }

  async function spotifyJson(url: string, token: string, email: string): Promise<JsonObject> {
    // A sibling track lookup or a request awaiting token refresh may establish
    // the cooldown after spotify() started. Gate every new outbound request.
    if ((spotifyCooldowns.get(email) ?? 0) > now()) throw new Error('artist_metadata_cooldown');
    try { return await json(url, token); }
    catch (error) { coolDown(email, error); throw error; }
  }

  async function spotify(name: string, songs: readonly MetadataSong[], email: string): Promise<ArtistProfile | null> {
    if (!options.getAccessToken || (spotifyCooldowns.get(email) ?? 0) > now()) return null;
    spotifyCooldowns.delete(email);
    try {
      const token = await bounded(() => options.getAccessToken!(email));
      if (!token) return null;
      // Bounded enrichment only; the library endpoints never limit their songs.
      const trackIds = [...new Set(songs.map((song) => song.spotify_track_id).filter(validId))].slice(0, 3);
      const tracks = await Promise.all(trackIds.map(async (id) => {
        try {
          return await memo(`spotify-track:${id}`, async () => {
            const track = await spotifyJson(`https://api.spotify.com/v1/tracks/${id}`, token, email);
            // Retain only public artist identity, not the full track or caller's library.
            return array(track.artists).map(object).filter((artist) => validId(artist.id) && typeof artist.name === 'string')
              .map((artist) => ({ id: String(artist.id), name: String(artist.name) }));
          }, (artists) => artists.length ? successTtl : 0) ?? [];
        } catch { return []; }
      }));
      const ids = new Set<string>();
      for (const track of tracks) for (const artist of track) {
        if (artistKey(artist.name) === artistKey(name)) ids.add(artist.id);
      }
      if (ids.size !== 1) return null;
      const id = [...ids][0];
      // ID-keyed positive cache is independent of anonymous name-search misses.
      return await memo(`spotify:${id}`, async () => {
        try {
          const artist = await spotifyJson(`https://api.spotify.com/v1/artists/${id}`, token, email);
          if (artist.id !== id || typeof artist.name !== 'string' || artistKey(artist.name) !== artistKey(name)) return null;
          const images = array(artist.images).map(object).sort((a, b) => Number(b.width ?? 0) - Number(a.width ?? 0));
          const imageUrl = images.map((image) => safeUrl(image.url, ['i.scdn.co', 'mosaic.scdn.co'], '/image/')).find(Boolean) ?? null;
          const path = `/artist/${id}`;
          const sourceUrl = safeUrl(object(artist.external_urls).spotify, ['open.spotify.com'], path);
          return {
            name: artist.name.trim(), imageUrl, description: null,
            genres: [...new Set(array(artist.genres).filter((genre): genre is string => typeof genre === 'string' && !!genre.trim()).map((genre) => genre.trim()))],
            source: 'Spotify', sourceUrl: sourceUrl && new URL(sourceUrl).pathname === path ? sourceUrl : null,
          };
        } catch { return null; }
      }, (profile) => profile ? successTtl : 0) ?? null;
    } catch { return null; }
  }

  return async function resolve(name: string, songs: readonly MetadataSong[] = [], userEmail?: string | null): Promise<ArtistProfile> {
    if (!artistKey(name)) return neutral(name);
    if (userEmail) {
      const verified = await spotify(name, songs, userEmail);
      if (verified) return verified;
    }
    const profile = await deezer(name);
    return profile.source ? profile : neutral(name);
  };
}

export const getArtistProfile = createArtistMetadataResolver({
  getAccessToken: async (email) => {
    const { getSpotifyTokenForUser } = await import('./spotify');
    return getSpotifyTokenForUser(email);
  },
});
