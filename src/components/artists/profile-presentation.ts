import type { ArtistProfileOverride } from '@/lib/artist-profile-types';

type ProfileLocale = 'zh-CN' | 'zh-TW' | 'en' | 'ja';
export type BindingSource = 'spotify' | 'musicbrainz' | 'wikidata';
export interface ArtistProfileDraft {
  imageUrl: string; sourceUrl: string; descriptions: Record<ProfileLocale, string>;
  aliases: string; genres: string; kind: '' | 'person' | 'group' | 'other'; country: string;
  links: { website: string; spotify: string; youtube: string };
  spotifyArtistId: string; musicbrainzId: string; wikidataId: string; confirmIdentity: boolean;
  /** Distinguish deliberate suppression from blank/inherited fields in replacement PUTs. */
  explicitClears: string[];
}

export function safeArtistExternalHref(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return;
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !host.includes('.') || host.endsWith('.') || /^\d+(?:\.\d+){3}$/.test(host) || host.includes(':')
      || host === 'localhost' || /\.(?:localhost|local|internal|test|invalid)$/.test(host)) return;
    return url.href;
  } catch { return; }
}

export function profileDraftFromOverride(value: ArtistProfileOverride | null | undefined): ArtistProfileDraft {
  const text = (input: unknown) => typeof input === 'string' ? input : '';
  return {
    imageUrl: text(value?.imageUrl), sourceUrl: text(value?.sourceUrl),
    descriptions: { 'zh-CN': text(value?.descriptions?.['zh-CN']), 'zh-TW': text(value?.descriptions?.['zh-TW']), en: text(value?.descriptions?.en), ja: text(value?.descriptions?.ja) },
    aliases: value?.aliases?.join('\n') ?? '', genres: value?.genres?.join('\n') ?? '',
    kind: value?.kind ?? '', country: text(value?.country),
    links: { website: text(value?.links?.website), spotify: text(value?.links?.spotify), youtube: text(value?.links?.youtube) },
    spotifyArtistId: text(value?.spotifyArtistId), musicbrainzId: text(value?.musicbrainzId), wikidataId: text(value?.wikidataId),
    confirmIdentity: !!(value?.spotifyArtistId || value?.musicbrainzId || value?.wikidataId),
    explicitClears: value ? [
      ...Object.entries(value).filter(([key, entry]) => key !== 'descriptions' && (entry === null || (Array.isArray(entry) && entry.length === 0))).map(([key]) => key),
      ...Object.entries(value.descriptions ?? {}).filter(([, entry]) => entry === '').map(([language]) => `descriptions.${language}`),
    ] : [],
  };
}

export function buildArtistProfilePayload(draft: ArtistProfileDraft): { override: ArtistProfileOverride; confirmIdentity: boolean } | { error: string } {
  const override: ArtistProfileOverride = {};
  for (const key of ['imageUrl', 'kind', 'country', 'sourceUrl', 'spotifyArtistId', 'musicbrainzId', 'wikidataId'] as const) {
    if (draft.explicitClears.includes(key) && !draft[key]) override[key] = null;
  }
  for (const key of ['aliases', 'genres'] as const) if (draft.explicitClears.includes(key) && !draft[key].trim()) override[key] = [];
  const spotifyArtistId = draft.spotifyArtistId;
  const musicbrainzId = draft.musicbrainzId;
  const wikidataId = draft.wikidataId;
  if (spotifyArtistId && !/^[A-Za-z0-9]{22}$/.test(spotifyArtistId)) return { error: 'invalidSpotifyId' };
  if (musicbrainzId && !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(musicbrainzId)) return { error: 'invalidMusicBrainzId' };
  if (wikidataId && !/^Q[1-9]\d*$/.test(wikidataId)) return { error: 'invalidWikidataId' };
  if ((spotifyArtistId || musicbrainzId || wikidataId) && !draft.confirmIdentity) return { error: 'confirmIdentityRequired' };
  if (spotifyArtistId) override.spotifyArtistId = spotifyArtistId;
  if (musicbrainzId) override.musicbrainzId = musicbrainzId;
  if (wikidataId) override.wikidataId = wikidataId;
  const country = draft.country.trim();
  if (country && !/^[A-Z]{2}$/.test(country)) return { error: 'invalidCountry' };
  if (country) override.country = country;
  if (draft.kind) override.kind = draft.kind;
  const descriptions: Partial<Record<ProfileLocale, string>> = {};
  for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja'] as const) {
    const text = draft.descriptions[locale].trim();
    if (text.length > 4000) return { error: 'textTooLong' };
    if (text || draft.explicitClears.includes(`descriptions.${locale}`)) descriptions[locale] = text;
  }
  if (Object.keys(descriptions).length) override.descriptions = descriptions;
  for (const key of ['aliases', 'genres'] as const) {
    const lines = [...new Set(draft[key].split('\n').map((line) => line.trim()).filter(Boolean))];
    if (lines.length > (key === 'aliases' ? 50 : 30) || lines.some((line) => line.length > 200)) return { error: 'textTooLong' };
    if (lines.length) override[key] = lines;
  }
  for (const key of ['imageUrl', 'sourceUrl'] as const) {
    if (!draft[key].trim()) continue;
    const url = safeArtistExternalHref(draft[key]);
    if (!url) return { error: key === 'imageUrl' ? 'invalidImageUrl' : 'invalidLink' };
    override[key] = url;
  }
  const links: NonNullable<ArtistProfileOverride['links']> = {};
  for (const key of ['website', 'spotify', 'youtube'] as const) {
    if (!draft.links[key].trim()) continue;
    const url = safeArtistExternalHref(draft.links[key]);
    if (!url) return { error: 'invalidLink' };
    links[key] = url;
  }
  if (Object.keys(links).length) override.links = links;
  if (new TextEncoder().encode(JSON.stringify(override)).byteLength > 32768) return { error: 'profileTooLarge' };
  return { override, confirmIdentity: draft.confirmIdentity };
}

export function resolveArtistDescription(profile: { description?: string | null; descriptions?: Partial<Record<ProfileLocale, string>> }, locale: ProfileLocale): { text: string; language: ProfileLocale | null } {
  if (profile.descriptions && Object.hasOwn(profile.descriptions, locale) && profile.descriptions[locale] === '') return { text: '', language: locale };
  const related: ProfileLocale[] = locale.startsWith('zh') ? ['zh-CN', 'zh-TW'] : [];
  for (const language of [...new Set([locale, ...related, 'en', 'zh-CN', 'ja', 'zh-TW'] as ProfileLocale[])]) {
    const text = profile.descriptions?.[language]?.trim();
    if (text) return { text, language };
  }
  return { text: profile.description?.trim() ?? '', language: null };
}

export function sameProfileRecord(left: unknown, right: unknown): boolean {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stable(entry)]));
    return value;
  };
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}
