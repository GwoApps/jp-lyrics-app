import type { ArtistProfile } from './artists.ts';
import type { ArtistProfileBindings, ArtistProfileLookupSource, ArtistProfileSource } from './artist-profile-types.ts';
import { ArtistProfileError, isRecord, ISO_COUNTRIES, PROFILE_LOCALES, readArtistJson, safeArtistUrl, validArtistSourceId } from './artist-profile-validation.ts';

const object = (value: unknown): Record<string, unknown> => isRecord(value) ? value : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown, max = 200): string | null => typeof value === 'string' && !!value.trim()
  && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) ? value.trim() : null;
const strings = (value: unknown, max = 50): string[] => [...new Set(list(value).map((v) => text(v)).filter((v): v is string => !!v))].slice(0, max);
export const emptyManagedArtistProfile = (name: string): ArtistProfile => ({ name, imageUrl: null, description: null, genres: [], source: null, sourceUrl: null });
export const ARTIST_METADATA_USER_AGENT = 'jp-lyrics-app/0.1.0 (https://github.com/GwoApps/jp-lyrics-app)';

/** Actual field paths, not vague whole-profile attribution. */
export function artistProfileFields(profile: ArtistProfile): string[] {
  const fields: string[] = [];
  for (const key of ['imageUrl', 'description', 'country', 'kind'] as const) if (profile[key] !== undefined && profile[key] !== null) fields.push(key);
  for (const key of ['genres', 'aliases'] as const) if (profile[key]?.length) fields.push(key);
  for (const key of ['descriptions', 'links', 'bindings'] as const) {
    for (const [field, value] of Object.entries(profile[key] ?? {})) if (value !== null && value !== undefined) fields.push(`${key}.${field}`);
  }
  return fields;
}

function finish(profile: ArtistProfile, binding: ArtistProfileBindings, now: number): ArtistProfile {
  profile.bindings = binding;
  profile.updatedAt = new Date(now).toISOString();
  profile.sources = [{ label: profile.source!, url: profile.sourceUrl, fields: ['name', ...artistProfileFields(profile)] }];
  return profile;
}

function musicbrainz(body: unknown, id: string, now: number): ArtistProfile {
  const artist = object(body);
  if (typeof artist.id !== 'string' || artist.id.toLowerCase() !== id.toLowerCase() || !text(artist.name, 300)) throw new ArtistProfileError('artist_profile_lookup_not_found', 404);
  const profile = emptyManagedArtistProfile(text(artist.name, 300)!);
  profile.source = 'MusicBrainz'; profile.sourceUrl = `https://musicbrainz.org/artist/${id}`;
  profile.links = { musicbrainz: profile.sourceUrl };
  profile.aliases = strings(list(artist.aliases).map((alias) => object(alias).name));
  profile.kind = artist.type === 'Person' ? 'person' : artist.type === 'Group' ? 'group' : text(artist.type) ? 'other' : null;
  profile.country = typeof artist.country === 'string' && ISO_COUNTRIES.has(artist.country) ? artist.country : null;
  // Disambiguation is a short identity note, not a fabricated biography.
  profile.description = text(artist.disambiguation, 4000);
  if (profile.description) profile.descriptions = { en: profile.description };
  for (const entry of list(artist.relations).slice(0, 200)) {
    const relation = object(entry);
    if (relation.ended === true || relation['target-type'] !== 'url') continue;
    const url = object(relation.url).resource;
    if (relation.type === 'official homepage' && !profile.links.website) profile.links.website = safeArtistUrl(url) ?? undefined;
    if (relation.type === 'youtube' && !profile.links.youtube) profile.links.youtube = safeArtistUrl(url, 'youtube') ?? undefined;
    if (relation.type === 'wikidata' && typeof url === 'string' && /^https:\/\/www\.wikidata\.org\/wiki\/Q[1-9][0-9]{0,11}$/.test(url)) profile.links.wikidata = url;
    if (relation.type === 'streaming' && !profile.links.spotify) profile.links.spotify = safeArtistUrl(url, 'spotify') ?? undefined;
  }
  return finish(profile, { musicbrainzId: id }, now);
}

function wikidata(body: unknown, id: string, now: number): ArtistProfile {
  const entity = object(object(object(body).entities)[id]);
  if (entity.id !== id || entity.type !== 'item' || entity.missing !== undefined) throw new ArtistProfileError('artist_profile_lookup_not_found', 404);
  const labels = object(entity.labels);
  const name = text(object(labels.en).value, 300) ?? text(object(labels.ja).value, 300)
    ?? Object.values(labels).map((label) => text(object(label).value, 300)).find(Boolean);
  if (!name) throw new ArtistProfileError('artist_profile_lookup_not_found', 404);
  const profile = emptyManagedArtistProfile(name);
  profile.source = 'Wikidata'; profile.sourceUrl = `https://www.wikidata.org/wiki/${id}`;
  profile.links = { wikidata: profile.sourceUrl };
  const claims = object(entity.claims);
  const values = (property: string): unknown[] => list(claims[property]).filter((claim) => object(claim).rank !== 'deprecated')
    .map((claim) => object(object(object(claim).mainsnak).datavalue).value);
  const kinds = values('P31').map((value) => object(value).id);
  profile.kind = kinds.includes('Q5') ? 'person' : kinds.includes('Q215380') || kinds.includes('Q2088357') ? 'group' : null;
  const descriptions = object(entity.descriptions);
  profile.descriptions = {};
  const languageMap = { 'zh-CN': ['zh-cn', 'zh-hans', 'zh'], 'zh-TW': ['zh-tw', 'zh-hant', 'zh'], en: ['en'], ja: ['ja'] };
  for (const locale of PROFILE_LOCALES) {
    const value = languageMap[locale].map((lang) => text(object(descriptions[lang]).value, 4000)).find(Boolean);
    if (value) profile.descriptions[locale] = value;
  }
  profile.description = profile.descriptions.en ?? profile.descriptions.ja ?? profile.descriptions['zh-CN'] ?? profile.descriptions['zh-TW'] ?? null;
  profile.aliases = strings(Object.values(object(entity.aliases)).flatMap((aliases) => list(aliases).map((alias) => object(alias).value)));
  profile.links.website = values('P856').map((url) => safeArtistUrl(url)).find(Boolean) ?? undefined;
  const spotifyId = values('P1902').find((value) => validArtistSourceId('spotify', value));
  if (spotifyId) profile.links.spotify = `https://open.spotify.com/artist/${spotifyId}`;
  const mbId = values('P434').find((value) => validArtistSourceId('musicbrainz', value));
  if (mbId) profile.links.musicbrainz = `https://musicbrainz.org/artist/${mbId}`;
  const channel = values('P2397').find((value) => typeof value === 'string' && /^UC[A-Za-z0-9_-]{22}$/.test(value));
  if (channel) profile.links.youtube = `https://www.youtube.com/channel/${channel}`;
  // Country/genre entity labels and Commons image licenses require additional
  // lookups. Leave unknown rather than guessing a country or using Q IDs as text.
  return finish(profile, { wikidataId: id }, now);
}

function spotify(body: unknown, id: string, now: number): ArtistProfile {
  const artist = object(body);
  if (artist.id !== id || !text(artist.name, 300) || artist.type !== 'artist') throw new ArtistProfileError('artist_profile_lookup_not_found', 404);
  const profile = emptyManagedArtistProfile(text(artist.name, 300)!);
  profile.source = 'Spotify'; profile.sourceUrl = `https://open.spotify.com/artist/${id}`;
  profile.links = { spotify: profile.sourceUrl };
  profile.genres = strings(artist.genres, 30);
  profile.imageUrl = list(artist.images).map(object).sort((a, b) => Number(b.width ?? 0) - Number(a.width ?? 0))
    .map((image) => safeArtistUrl(image.url, 'image')).find((url) => url && new URL(url).hostname === 'i.scdn.co' && new URL(url).pathname.startsWith('/image/')) ?? null;
  return finish(profile, { spotifyArtistId: id }, now);
}

interface LookupOptions {
  fetch?: typeof fetch;
  now?: () => number;
  getAccessToken?: (email: string) => Promise<string | null>;
  timeoutMs?: number;
  maxEntries?: number;
  successTtlMs?: number;
  failureTtlMs?: number;
}

/** Fixed endpoints only. Exact IDs only. No arbitrary URLs, redirects, searches, or relation crawling. */
export function createArtistProfileLookup(options: LookupOptions = {}) {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const max = Math.max(1, Math.min(256, options.maxEntries ?? 128));
  const timeoutMs = Math.max(1, Math.min(10000, options.timeoutMs ?? 3500));
  type Entry = { expires: number; staleUntil?: number; profile?: ArtistProfile; error?: ArtistProfileError };
  const cache = new Map<string, Entry>();
  const pending = new Map<string, Promise<ArtistProfile>>();
  const nextRequest = new Map<ArtistProfileLookupSource, number>();
  const privateFailures = new Map<string, number>();
  const successTtl = Math.min(86400000, Math.max(0, options.successTtlMs ?? 21600000));
  const failureTtl = Math.min(300000, Math.max(0, options.failureTtlMs ?? 60000));
  function remember(key: string, value: Entry) {
    cache.delete(key);
    while (cache.size >= max) cache.delete(cache.keys().next().value!);
    cache.set(key, value);
  }
  async function bounded<T>(load: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([load(controller.signal), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new ArtistProfileError('artist_profile_lookup_unavailable', 502)); }, timeoutMs);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
  return async function lookup(source: ArtistProfileLookupSource, id: string, email?: string | null): Promise<ArtistProfile> {
    if (!['musicbrainz', 'wikidata', 'spotify'].includes(source) || !validArtistSourceId(source, id)) throw new ArtistProfileError('artist_profile_invalid_id');
    const key = `${source}:${id}`;
    const cached = cache.get(key);
    if (cached && cached.expires > now()) {
      if (cached.error) throw cached.error;
      return structuredClone(cached.profile!);
    }
    const stale = cached?.profile && (cached.staleUntil ?? 0) > now() ? cached : null;
    cache.delete(key);
    const pendingKey = source === 'spotify' ? `${key}:${email ?? ''}` : key;
    const running = pending.get(pendingKey);
    // Public successes may be shared, but token failures must never be shared
    // across Spotify users or block a different user's valid connection.
    if (running) return structuredClone(await running);
    if (pending.size >= max || (nextRequest.get(source) ?? 0) > now()) {
      if (stale) { remember(key, stale); return structuredClone(stale.profile!); }
      throw new ArtistProfileError('artist_profile_lookup_rate_limited', 429);
    }
    const job = (async () => {
      let token: string | null = null;
      if (source === 'spotify') {
        const userKey = email ?? '';
        if (!email || !options.getAccessToken || (privateFailures.get(userKey) ?? 0) > now()) throw new ArtistProfileError('artist_profile_spotify_not_connected', 409);
        try { token = await bounded(() => options.getAccessToken!(email)); } catch { /* stable code below */ }
        if (!token) {
          while (privateFailures.size >= max) privateFailures.delete(privateFailures.keys().next().value!);
          privateFailures.set(userKey, now() + failureTtl);
          throw new ArtistProfileError('artist_profile_spotify_not_connected', 409);
        }
      }
      // Set after token acquisition, rechecking in case another refresh won.
      if ((nextRequest.get(source) ?? 0) > now()) throw new ArtistProfileError('artist_profile_lookup_rate_limited', 429);
      nextRequest.set(source, now() + (source === 'spotify' ? 250 : 1100));
      try {
        const profile = await bounded(async (signal) => {
          const url = source === 'musicbrainz' ? `https://musicbrainz.org/ws/2/artist/${id}?fmt=json&inc=aliases%2Burl-rels`
            : source === 'wikidata' ? `https://www.wikidata.org/wiki/Special:EntityData/${id}.json`
            : `https://api.spotify.com/v1/artists/${id}`;
          const response = await fetcher(url, { signal, redirect: 'error', cache: 'no-store', headers: {
            Accept: 'application/json', 'User-Agent': ARTIST_METADATA_USER_AGENT, ...(token ? { Authorization: `Bearer ${token}` } : {}),
          } });
          try {
            if (response.status === 429) {
              const retry = response.headers.get('Retry-After');
              const duration = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - now() : failureTtl;
              nextRequest.set(source, now() + Math.max(failureTtl, Math.min(3600000, Number.isFinite(duration) ? duration : failureTtl)));
              throw new ArtistProfileError('artist_profile_lookup_rate_limited', 429);
            }
            if (source === 'spotify' && (response.status === 401 || response.status === 403)) {
              while (privateFailures.size >= max) privateFailures.delete(privateFailures.keys().next().value!);
              privateFailures.set(email!, now() + failureTtl);
              throw new ArtistProfileError('artist_profile_spotify_not_connected', 409);
            }
            if (response.status === 404) throw new ArtistProfileError('artist_profile_lookup_not_found', 404);
            if (!response.ok || !/^application\/(?:[\w.+-]+\+)?json(?:;|$)/i.test(response.headers.get('Content-Type') ?? '')) throw new ArtistProfileError('artist_profile_lookup_unavailable', 502);
            let body: unknown;
            try { body = await readArtistJson(response, 1048576, 'artist_profile_lookup_unavailable'); }
            catch { throw new ArtistProfileError('artist_profile_lookup_unavailable', 502); }
            return source === 'musicbrainz' ? musicbrainz(body, id, now()) : source === 'wikidata' ? wikidata(body, id, now()) : spotify(body, id, now());
          } finally { void response.body?.cancel().catch(() => {}); }
        });
        remember(key, { profile, expires: now() + successTtl, staleUntil: now() + 86400000 });
        return profile;
      } catch (error) {
        const failure = error instanceof ArtistProfileError ? error : new ArtistProfileError('artist_profile_lookup_unavailable', 502);
        if (failure.message !== 'artist_profile_spotify_not_connected') remember(key, { error: failure, expires: now() + failureTtl });
        throw failure;
      }
    })();
    // Deduplicate the complete outcome, including stale-on-transient-error,
    // rather than exposing the raw failed job to concurrent readers.
    const complete = job.catch((error: unknown) => {
      // Only the same exact ID's successful public data may survive a transient
      // outage (24h maximum), with its original real fetch timestamp.
      if (stale && error instanceof ArtistProfileError && error.message !== 'artist_profile_lookup_not_found') {
        remember(key, { ...stale, expires: Math.min(stale.staleUntil!, now() + failureTtl) });
        return stale.profile!;
      }
      throw error;
    });
    pending.set(pendingKey, complete);
    try { return structuredClone(await complete); }
    finally { pending.delete(pendingKey); }
  };
}

export const lookupArtistProfile = createArtistProfileLookup({
  getAccessToken: async (email) => {
    const { getSpotifyTokenForUser } = await import('./spotify');
    return getSpotifyTokenForUser(email);
  },
});
export type ArtistProfileLookup = ReturnType<typeof createArtistProfileLookup>;
export type { ArtistProfileSource };
