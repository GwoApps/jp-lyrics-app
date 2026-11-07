export const LYRIC_FOLLOW_RESUME_MS = 6000;

export const IMMERSIVE_FONT_SIZES = [
  { mobile: 28, desktop: 32 },
  { mobile: 30, desktop: 38 },
  { mobile: 34, desktop: 44 },
  { mobile: 37, desktop: 50 },
  { mobile: 40, desktop: 56 },
] as const;
export const IMMERSIVE_FONT_STORAGE_KEY = 'jplrc-immersive-font-step';

export function parseImmersiveFontStep(saved: string | null): number {
  const step = saved?.trim() ? Number(saved) : NaN;
  return Number.isInteger(step) && step >= 0 && step < IMMERSIVE_FONT_SIZES.length ? step : 2;
}

/** Keep the view addressable without starting another song/Spotify controller. */
export function lyricsViewUrl(url: string, enabled: boolean): string {
  const next = new URL(url);
  if (enabled) next.searchParams.set('view', 'lyrics');
  else next.searchParams.delete('view');
  return `${next.pathname}${next.search}${next.hash}`;
}

export function isLyricsView(url: string): boolean {
  return new URL(url).searchParams.get('view') === 'lyrics';
}

/** Geometry is relative to the scrolling container, not an offsetParent. */
export function centeredLyricScrollTop(
  scrollTop: number,
  viewportHeight: number,
  lineTopInViewport: number,
  lineHeight: number,
): number {
  return scrollTop + lineTopInViewport - viewportHeight / 2 + lineHeight / 2;
}

/** Resume following after the user has had time to read the browsed lyric pair. */
export function shouldFollowImmersiveLyrics(now: number, manualUntil: number): boolean {
  return now >= manualUntil;
}
