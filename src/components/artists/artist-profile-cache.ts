import { artistKey, type ArtistProfile } from '@/lib/artists';

/** In-memory public portraits only; never retain library rows or authorization state. */
export function createArtistProfileCache(now = Date.now, capacity = 256, ttl = 5 * 60_000) {
  const profiles = new Map<string, { profile: ArtistProfile; at: number }>();
  const loaded = new Map<string, number>();
  function trim<T>(cache: Map<string, T>) {
    while (cache.size > capacity) cache.delete(cache.keys().next().value!);
  }
  return {
    get(name: string): ArtistProfile | null {
      const key = artistKey(name);
      const entry = profiles.get(key);
      if (!entry || now() - entry.at >= ttl) { profiles.delete(key); return null; }
      profiles.delete(key); profiles.set(key, entry);
      return entry.profile;
    },
    set(profile: ArtistProfile) {
      const key = artistKey(profile.name);
      profiles.delete(key); profiles.set(key, { profile, at: now() }); trim(profiles);
    },
    isLoaded(url: string | null | undefined): boolean {
      if (!url) return false;
      const at = loaded.get(url);
      if (at === undefined || now() - at >= ttl) { loaded.delete(url); return false; }
      return true;
    },
    markLoaded(url: string) {
      loaded.delete(url); loaded.set(url, now()); trim(loaded);
    },
  };
}

const cache = createArtistProfileCache();
export const getCachedArtistProfile = cache.get;
export const setCachedArtistProfile = cache.set;
export const isArtistPortraitLoaded = cache.isLoaded;
export const markArtistPortraitLoaded = cache.markLoaded;

/** Injective CSS-safe name: preserve artist identity without collisions or punctuation escaping. */
export function artistTransitionName(name: string): string {
  return `artist-avatar-${Array.from(artistKey(name)).map((character) => character.codePointAt(0)!.toString(16)).join('-')}`;
}
