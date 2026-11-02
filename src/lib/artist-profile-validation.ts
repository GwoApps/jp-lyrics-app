import { artistKey } from './artists.ts';
import type { ArtistProfileLookupSource, ArtistProfileOverride } from './artist-profile-types.ts';

export const MAX_ARTIST_PROFILE_BYTES = 32768;
export class ArtistProfileError extends Error {
  readonly status: number;
  constructor(code: string, status = 400) { super(code); this.name = 'ArtistProfileError'; this.status = status; }
}
export const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const PROFILE_LOCALES = ['zh-CN', 'zh-TW', 'en', 'ja'] as const;
const allowed = ['imageUrl', 'descriptions', 'aliases', 'kind', 'country', 'genres', 'links', 'spotifyArtistId', 'musicbrainzId', 'wikidataId', 'sourceUrl', 'updatedAt'];
const invalid = (): never => { throw new ArtistProfileError('artist_profile_invalid_override'); };

export function validArtistSourceId(source: ArtistProfileLookupSource, id: unknown): id is string {
  if (typeof id !== 'string') return false;
  // Validate the literal input; never trim, extract from URLs, or repair IDs.
  if (source === 'spotify') return /^[A-Za-z0-9]{22}$/.test(id);
  if (source === 'wikidata') return /^Q[1-9][0-9]{0,11}$/.test(id);
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id);
}

/** Display URLs only: NEVER passed to server fetch. Upstream fetch has a separate fixed origin. */
export function safeArtistUrl(value: unknown, role: 'website' | 'spotify' | 'youtube' | 'image' = 'website'): string | null {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !host.includes('.')
      || host.includes(':') || /^[\d.]+$/.test(host) || host.endsWith('.')
      || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/.test(host)
      || !host.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null;
    if (role === 'spotify' && (host !== 'open.spotify.com' || !/^\/artist\/[A-Za-z0-9]{22}\/?$/.test(url.pathname))) return null;
    if (role === 'youtube' && (!['youtube.com', 'www.youtube.com', 'music.youtube.com'].includes(host)
      || !/^\/(?:channel\/UC[A-Za-z0-9_-]{22}|@[A-Za-z0-9_.%-]+|c\/[A-Za-z0-9_.%-]+|user\/[A-Za-z0-9_.%-]+)\/?$/.test(url.pathname))) return null;
    return value;
  } catch { return null; }
}

export function artistOverrideKey(name: string): string {
  if (typeof name !== 'string' || !artistKey(name) || name.length > 300 || /[\u0000-\u001f\u007f]/u.test(name)) {
    throw new ArtistProfileError('artist_profile_invalid_name');
  }
  return `artist_profile:${artistKey(name)}`;
}

export function validateArtistProfileOverride(input: unknown): ArtistProfileOverride {
  if (!isRecord(input) || Object.keys(input).some((key) => !allowed.includes(key))) return invalid();
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > MAX_ARTIST_PROFILE_BYTES) return invalid();
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'aliases' || key === 'genres') {
      if (!Array.isArray(value) || value.length > (key === 'aliases' ? 50 : 30)
        || value.some((item) => typeof item !== 'string' || !item.trim() || item.length > 200 || /[\u0000-\u001f\u007f]/u.test(item))) return invalid();
      output[key] = [...new Set(value.map((item: string) => item.trim()))];
    } else if (key === 'descriptions') {
      if (!isRecord(value) || Object.keys(value).some((locale) => !PROFILE_LOCALES.includes(locale as typeof PROFILE_LOCALES[number]))
        || Object.values(value).some((text) => typeof text !== 'string' || text.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text))) return invalid();
      output[key] = { ...value };
    } else if (key === 'links') {
      if (!isRecord(value) || Object.keys(value).some((role) => !['website', 'spotify', 'youtube'].includes(role))) return invalid();
      for (const [role, url] of Object.entries(value)) if (!safeArtistUrl(url, role as 'website' | 'spotify' | 'youtube')) return invalid();
      output[key] = { ...value };
    } else if (key === 'kind') {
      if (value !== null && (typeof value !== 'string' || !['person', 'group', 'other'].includes(value))) return invalid();
      output[key] = value;
    } else if (key === 'country') {
      if (value !== null && (typeof value !== 'string' || !/^[A-Z]{2}$/.test(value)
        || !ISO_COUNTRIES.has(value))) return invalid();
      output[key] = value;
    } else if (key === 'spotifyArtistId' || key === 'musicbrainzId' || key === 'wikidataId') {
      const source = key === 'spotifyArtistId' ? 'spotify' : key === 'musicbrainzId' ? 'musicbrainz' : 'wikidata';
      if (value !== null && !validArtistSourceId(source, value)) return invalid();
      output[key] = value;
    } else if (key === 'updatedAt') {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value))) return invalid();
      output[key] = value;
    } else {
      if (value !== null && !safeArtistUrl(value, key === 'imageUrl' ? 'image' : 'website')) return invalid();
      output[key] = value;
    }
  }
  return output as ArtistProfileOverride;
}

// ISO 3166-1 alpha-2; unknown MusicBrainz area codes (e.g. XW) remain null.
export const ISO_COUNTRIES = new Set(('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' '));

/** Bounded stream reading covers chunked bodies as well as Content-Length. */
export async function readArtistJson(response: Response | Request, maxBytes: number, code: string, timeoutMs = 3500): Promise<unknown> {
  const declared = response.headers.get('Content-Length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new ArtistProfileError(code);
  const reader = response.body?.getReader();
  if (!reader) throw new ArtistProfileError(code);
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ArtistProfileError(code));
      void reader.cancel().catch(() => {});
    }, timeoutMs);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new ArtistProfileError(code);
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { throw new ArtistProfileError(code); }
  finally {
    if (timer) clearTimeout(timer);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
