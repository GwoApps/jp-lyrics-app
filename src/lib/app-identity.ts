/**
 * Product name and description shown outside the React tree: the browser tab,
 * the iOS home-screen icon and the PWA manifest.
 *
 * These surfaces are rendered before (or without) the active locale, so the
 * name here is deliberately language-neutral — the Japanese title plus its
 * Latin name, matching the README. Once the app hydrates, `AppMetadataSync`
 * replaces the tab title and the iOS name with `common.appName` from the
 * dictionaries, so a zh-TW reader sees 歌詞筆記 rather than a Japanese or
 * Chinese-only default.
 *
 * `public/manifest.json` cannot import this module, so
 * `src/lib/app-identity.test.ts` keeps the two in sync.
 */
export const APP_NAME_NEUTRAL = '歌詞ノート · Lyrics Note';

/** Home-screen label: the product's proper name, short enough to fit an icon label. */
export const APP_NAME_SHORT = '歌詞ノート';

/** Manifest/description copy; English is the project's lingua franca for metadata. */
export const APP_DESCRIPTION = 'Japanese lyrics management with furigana annotation and Spotify sync';
