/** Client-safe public metadata contracts. No server dependencies. */
export type ArtistProfileLocale = 'zh-CN' | 'zh-TW' | 'en' | 'ja';
export type ArtistProfileKind = 'person' | 'group' | 'other' | null;
export interface ArtistProfileBindings {
  spotifyArtistId?: string | null;
  musicbrainzId?: string | null;
  wikidataId?: string | null;
}
export interface ArtistProfileLinks {
  website?: string;
  spotify?: string;
  youtube?: string;
  musicbrainz?: string;
  wikidata?: string;
}
export interface ArtistProfileSource { label: string; url: string | null; fields: string[] }
/**
 * PUT replaces the record, not a patch. Missing fields inherit automatic values.
 * Null explicitly clears nullable scalars; [] explicitly clears aliases/genres.
 * Description locales and link keys merge individually; an empty description
 * suppresses that locale. Omit a key to inherit it again. Empty links inherit.
 * Null IDs remove the explicit binding (they do not blacklist automatic lookup).
 * Any non-null ID disables name-based fallback, even if that source is offline.
 * updatedAt is server-owned; round-tripping it is accepted but never trusted.
 */
export interface ArtistProfileOverride extends ArtistProfileBindings {
  imageUrl?: string | null;
  descriptions?: Partial<Record<ArtistProfileLocale, string>>;
  aliases?: string[];
  kind?: ArtistProfileKind;
  country?: string | null;
  genres?: string[];
  links?: Pick<ArtistProfileLinks, 'website' | 'spotify' | 'youtube'>;
  sourceUrl?: string | null;
  updatedAt?: string;
}
export type ArtistProfileLookupSource = 'musicbrainz' | 'wikidata' | 'spotify';
