import type { ArtistProfile } from './artists.ts';
import type { ArtistProfileOverride, ArtistProfileSource } from './artist-profile-types.ts';
import { getArtistProfile } from './artist-metadata.ts';
import { artistProfileFields, emptyManagedArtistProfile, lookupArtistProfile, type ArtistProfileLookup } from './artist-profile-lookup.ts';

interface ManagedProfileOptions {
  getOverride: (name: string) => Promise<ArtistProfileOverride | null>;
  lookup?: ArtistProfileLookup;
  automatic?: typeof getArtistProfile;
}

/** Merge only public metadata; there is deliberately no merged profile cache. */
export function mergeArtistProfile(name: string, profiles: readonly ArtistProfile[], override: ArtistProfileOverride | null): ArtistProfile {
  const result = emptyManagedArtistProfile(name);
  result.aliases = []; result.kind = null; result.country = null;
  result.descriptions = {}; result.links = {}; result.bindings = {};
  const owners = new Map<string, ArtistProfileSource>();
  const own = (field: string, source: ArtistProfileSource) => owners.set(field, source);
  let latest: string | null = null;
  // First provider wins a populated field; unknowns never erase a known value.
  for (const profile of profiles) {
    const source: ArtistProfileSource = { label: profile.source ?? 'Public metadata', url: profile.sourceUrl, fields: [] };
    const provenance = (field: string) => profile.sources?.find((entry) => entry.fields.includes(field)) ?? source;
    if (!result.source && profile.source) { result.source = profile.source; result.sourceUrl = profile.sourceUrl; }
    for (const field of ['imageUrl', 'description', 'country', 'kind'] as const) {
      const value = profile[field];
      if (result[field] == null && value !== undefined && value !== null) {
        Object.assign(result, { [field]: value }); own(field, provenance(field));
      }
    }
    for (const field of ['aliases', 'genres'] as const) {
      if (!result[field]?.length && profile[field]?.length) { result[field] = [...profile[field]!]; own(field, provenance(field)); }
    }
    for (const field of ['descriptions', 'links', 'bindings'] as const) {
      for (const [key, value] of Object.entries(profile[field] ?? {})) {
        if (value === undefined || value === null) continue;
        const target = result[field] as Record<string, unknown>;
        if (!(key in target)) { target[key] = value; own(`${field}.${key}`, provenance(`${field}.${key}`)); }
      }
    }
    if (profile.updatedAt && (!latest || profile.updatedAt > latest)) latest = profile.updatedAt;
  }
  if (override) {
    const manual: ArtistProfileSource = { label: 'Manual', url: override.sourceUrl ?? null, fields: [] };
    for (const field of ['imageUrl', 'aliases', 'kind', 'country', 'genres'] as const) {
      if (override[field] !== undefined) { Object.assign(result, { [field]: override[field] }); own(field, manual); }
    }
    for (const field of ['descriptions', 'links'] as const) {
      for (const [key, value] of Object.entries(override[field] ?? {})) {
        (result[field] as Record<string, unknown>)[key] = value; own(`${field}.${key}`, manual);
      }
    }
    // Compatibility description is English-first, not whichever locale happened
    // to be overridden. Locale-aware clients should use descriptions directly.
    const locale = ['en', 'ja', 'zh-CN', 'zh-TW'].find((key) => key in result.descriptions!);
    if (locale) {
      const descriptions = result.descriptions as Record<string, string>;
      result.description = descriptions[locale] || null;
      const owner = owners.get(`descriptions.${locale}`);
      if (owner) own('description', owner);
    }
    for (const field of ['spotifyArtistId', 'musicbrainzId', 'wikidataId'] as const) {
      if (override[field] !== undefined) { result.bindings![field] = override[field]; own(`bindings.${field}`, manual); }
    }
    if (override.updatedAt) latest = override.updatedAt;
    // The legacy single-source fields identify the primary visual/description
    // owner. Full per-field provenance below is authoritative for mixed sources.
    const primary = owners.get('imageUrl') ?? owners.get('description');
    if (primary) { result.source = primary.label; result.sourceUrl = primary.url; }
  }
  result.updatedAt = latest;
  const sources: ArtistProfileSource[] = [];
  for (const [field, owner] of owners) {
    let source = sources.find((entry) => entry.label === owner.label && entry.url === owner.url);
    if (!source) { source = { label: owner.label, url: owner.url, fields: [] }; sources.push(source); }
    source.fields.push(field);
  }
  result.sources = sources;
  return result;
}

export function createManagedArtistProfileResolver(options: ManagedProfileOptions) {
  const lookup = options.lookup ?? lookupArtistProfile;
  const automatic = options.automatic ?? getArtistProfile;
  return async function resolve(name: string, songs: Parameters<typeof getArtistProfile>[1] = [], email?: string | null): Promise<ArtistProfile> {
    let override: ArtistProfileOverride | null = null;
    try { override = await options.getOverride(name); }
    catch {
      // If KV is unavailable we cannot establish that no explicit binding
      // exists. Fail neutral rather than risk a same-name substitution.
      return mergeArtistProfile(name, [], null);
    }
    const profiles: ArtistProfile[] = [];
    // Explicit confirmed identities override the legacy name-matched provider.
    // No cross-ID crawling: relations can be shown as links but never fetched.
    const bindings = [
      ['spotify', override?.spotifyArtistId], ['wikidata', override?.wikidataId], ['musicbrainz', override?.musicbrainzId],
    ] as const;
    if (bindings.some(([, id]) => !!id)) {
      const resolved = await Promise.all(bindings.map(async ([source, id]) => {
        if (!id) return null;
        try { return await lookup(source, id, email); } catch { return null; }
      }));
      profiles.push(...resolved.filter((profile): profile is ArtistProfile => !!profile));
    } else {
      // Preserve the existing Spotify/Deezer resolver. It caches only public
      // upstream artist identities, never these ACL-scoped library rows.
      try { profiles.push(await automatic(name, songs, email)); } catch { /* neutral fallback */ }
    }
    return mergeArtistProfile(name, profiles, override);
  };
}

// Kept exported for tests/tools needing the set of actual populated field paths.
export { artistProfileFields };
