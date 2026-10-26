import type { FuriganaLine, FuriganaSegment } from './types';
import { isKanji, katakanaToHiragana } from './compound-readings';

/**
 * A dictionary reading describes a whole token. Match its kana runs back to
 * the visible text and leave only the intervening kanji runs with ruby. Never
 * guess a per-character reading inside a compound (今日, 一人, etc.).
 *
 * If a saved/manual reading does not contain the visible kana in order, keep
 * the segment untouched: silently discarding a correction would lose data.
 * The renderers suppress ruby on such unresolved mixed-script segments.
 */
export function splitJapaneseKanjiReading(segment: FuriganaSegment): FuriganaSegment[] {
  const chars = [...segment.text];
  if (!segment.reading || !chars.some(isKanji) || chars.every(isKanji)) return [segment];

  const runs: { text: string; kanji: boolean }[] = [];
  for (const char of chars) {
    const kanji = isKanji(char);
    const last = runs.at(-1);
    if (last && last.kanji === kanji) last.text += char;
    else runs.push({ text: char, kanji });
  }

  const reading = katakanaToHiragana(segment.reading).normalize('NFC');
  // Normalization can contract combining characters; do not slice the original
  // manual reading by indexes from a different-length normalized string.
  if (reading.length !== segment.reading.length) return [segment];
  const output: FuriganaSegment[] = [];
  let cursor = 0;
  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i];
    if (!run.kanji) {
      const kana = katakanaToHiragana(run.text).normalize('NFC');
      // A non-kana separator cannot be aligned to a dictionary pronunciation.
      if (!/^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u.test(run.text)
        || !reading.startsWith(kana, cursor)) return [segment];
      cursor += kana.length;
      output.push({ text: run.text, reading: '', ...(i > 0 || segment.joinPrev ? { joinPrev: true } : {}) });
      continue;
    }

    const next = runs[i + 1];
    const anchor = next ? katakanaToHiragana(next.text).normalize('NFC') : '';
    const end = next
      ? (i + 2 === runs.length && reading.endsWith(anchor)
        ? reading.length - anchor.length
        : reading.indexOf(anchor, cursor + 1))
      : reading.length;
    if (end <= cursor) return [segment];
    output.push({
      text: run.text, reading: segment.reading.slice(cursor, end),
      ...(segment.pos ? { pos: segment.pos } : {}),
      ...(i > 0 || segment.joinPrev ? { joinPrev: true } : {}),
    });
    cursor = end;
  }
  return cursor === reading.length ? output : [segment];
}

/** Only Japanese stored/generated annotations are normalized; Jyutping stays intact. */
export function normalizeJapaneseFuriganaLines(lines: readonly FuriganaLine[]): FuriganaLine[] {
  return lines.map((line) => ({
    segments: line.segments.flatMap(splitJapaneseKanjiReading),
  }));
}
