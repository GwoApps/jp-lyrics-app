/**
 * Map a stored lyrics source key onto an i18n label under the
 * `lyricsSources` namespace.
 *
 * Single source of truth — consumed by song detail page, song edit page,
 * and the useSongData hook.  When adding a new lyrics source, update this
 * object and the four locale files (`src/i18n/*.json`) together.
 */
export const LYRICS_SOURCE_KEYS: Record<string, string> = {
  manual: 'lyricsSources.manual',
  none: 'lyricsSources.none',
  'lrclib-exact': 'lyricsSources.lrclibExact',
  'lrclib-canonical': 'lyricsSources.lrclibCanonical',
  'lrclib-search': 'lyricsSources.lrclibSearch',
  petitlyrics: 'lyricsSources.petitlyrics',
  utanet: 'lyricsSources.utanet',
  ytmusic: 'lyricsSources.ytmusic',
};
