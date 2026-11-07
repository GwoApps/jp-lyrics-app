import type { FuriganaSegment } from './types';

export interface JapaneseReadingContext {
  word: string;
  start: number;
}

/** Reassemble the tokenizer word, without merging unrelated neighboring words. */
export function getJapaneseReadingContext(segments: readonly FuriganaSegment[], selected: number): JapaneseReadingContext {
  if (!Number.isInteger(selected) || selected < 0 || selected >= segments.length) return { word: '', start: 0 };
  let first = selected;
  while (first > 0 && segments[first].joinPrev) first -= 1;
  let end = selected + 1;
  while (end < segments.length && segments[end].joinPrev) end += 1;
  return {
    word: segments.slice(first, end).map((segment) => segment.text).join(''),
    start: segments.slice(first, selected).reduce((offset, segment) => offset + segment.text.length, 0),
  };
}
