/**
 * Katakana → hiragana script folding for *comparison only* (ISSUE #317).
 *
 * Japanese titles and artist names are written inconsistently between the two
 * kana scripts — 「さよなら」/「サヨナラ」, 「あいみょん」/「アイミョン」 — even though
 * they read exactly the same. `String.prototype.normalize('NFKC')` only folds
 * the halfwidth katakana block (ﾊﾝｶｸ → ハンカク); it never touches the fullwidth
 * katakana block, so NFKC alone leaves the two scripts unequal and every
 * downstream scorer returns 0.
 *
 * Folding both sides onto hiragana makes homophones compare equal, which is the
 * root fix for the title/artist/line hard gates. It is deliberately a pure
 * string transform: callers must keep using the *original* text for search
 * queries and for anything user-visible, and only fold the copies they compare.
 */

/** `ァ` (U+30A1) — first katakana letter that has a hiragana counterpart. */
const KATAKANA_START = 0x30a1;
/** `ヶ` (U+30F6) — last katakana letter that has a hiragana counterpart. */
const KATAKANA_END = 0x30f6;
/** Offset between the katakana and hiragana blocks (`ア` → `あ`). */
const KANA_SCRIPT_OFFSET = 0x60;

/**
 * Katakana letters outside `U+30A1–U+30F6` that still carry a regular hiragana
 * counterpart. These are *small* letters with no dedicated hiragana codepoint
 * block of their own:
 *
 * - `ヵ`/`ヶ` are the counters used in 「一ヵ月」/「三ヶ月」;
 * - `ヷヸヹヺ` are the (rare) voiced ワ row letters.
 *
 * `ヮ`→`ゎ`, `ヰ`/`ヱ`/`ヲ`/`ヿ` and `ヴ`→`ゔ` are already inside the numeric
 * range, so they need no entry here.
 */
const KATAKANA_EXCEPTIONS: ReadonlyMap<number, string> = new Map([
  [0x30f5, 'ゕ'], // ヵ → ゕ
  [0x30f6, 'ゖ'], // ヶ → ゖ
  [0x30f7, 'ゔ'], // ヷ → ゔ (ゔ is canonically ヴ, the voiced ウ)
  [0x30f8, 'ゔ'], // ヸ → ゔ
  [0x30f9, 'ゔ'], // ヹ → ゔ
  [0x30fa, 'ゔ'], // ヺ → ゔ
]);

/**
 * Fold every fullwidth katakana letter in `input` to its hiragana counterpart.
 *
 * - `U+30A1–U+30F6` map by subtracting `0x60` (「サ」→「さ」, 「ヴ」→「ゔ」);
 * - the exceptions above cover ヵヶ and the ヷ row;
 * - the long vowel mark `ー` (`U+30FC`, in the Common block) is intentionally
 *   left alone — it is a length marker shared by both scripts, not a letter;
 * - anything else (kanji, latin, digits, halfwidth katakana already normalised
 *   by NFKC) passes through untouched.
 */
export function foldKatakanaToHiragana(input: string): string {
  let result = '';
  for (const char of input) {
    const code = char.codePointAt(0);
    if (code === undefined) continue;
    if (code >= KATAKANA_START && code <= KATAKANA_END) {
      result += String.fromCodePoint(code - KANA_SCRIPT_OFFSET);
      continue;
    }
    result += KATAKANA_EXCEPTIONS.get(code) ?? char;
  }
  return result;
}
