export const LYRIC_FOLLOW_RESUME_MS = 2000;

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

/** One exception to centering: an intentional browse lasts until two seconds after the last input. */
export function shouldFollowImmersiveLyrics(now: number, manualUntil: number): boolean {
  return now >= manualUntil;
}
