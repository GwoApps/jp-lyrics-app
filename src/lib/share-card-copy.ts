import type { LyricLine } from './share-card.ts';

/**
 * Build the plain-text clipboard payload for the share page's copy actions.
 *
 * Source lines already have LRC timestamps stripped (that happens in
 * `getLyricLines`), so this is pure text assembly: no timing, no metadata tags.
 * With `withTranslation` each line's translation is emitted directly beneath its
 * source line, matching how the share card pairs them.
 */
export function buildShareCopyText(lines: LyricLine[], withTranslation: boolean): string {
  if (!withTranslation) return lines.map((line) => line.text).join('\n');
  return lines
    .map((line) => (line.translation ? `${line.text}\n${line.translation}` : line.text))
    .join('\n');
}
