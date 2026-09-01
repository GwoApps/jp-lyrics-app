import type { FuriganaLine } from '@/lib/types';
import { splitLyricScriptRuns } from '@/lib/romaji';

export function createPlainFuriganaLines(rawLyrics: string): FuriganaLine[] {
  return rawLyrics.split('\n').map((line) => ({
    segments: line.trim()
      ? splitLyricScriptRuns(line).map((text) => ({ text, reading: '' }))
      : [],
  }));
}
