/**
 * "May this write claim the whole cache is in the new language?" — the rule
 * behind the language stamp of a partial save (issue #394).
 *
 * The cache is one array plus ONE global language stamp
 * (`songs.lyrics_translation` + `songs.lyrics_translation_lang`), so the stamp
 * is only truthful while every line in it is in that language. The
 * proofreading page, however, loads whatever is stored — including a cache
 * written for a *previous* target language — and saves only the lines the user
 * touched. Stamping the whole cache with the current target language after such
 * a save claims the untouched lines too, and that claim is then believed by the
 * mismatch banner (which disappears), by the coverage counter (「已翻译 N/N」)
 * and by the whole-song cache short-circuit (issue #189's stamp refresh, gone
 * wrong).
 *
 * The invariant kept here: **stamp L after writing L ⟹ every non-empty line is
 * in L.** Two consequences drive the callers:
 *
 *  - a differing stored stamp MUST be preserved when lines of the old language
 *    survive the merge, and
 *  - a *blank* stored stamp must NOT be invented, because an unlabelled cache
 *    may still hold old-language lines and an unrecorded stamp is (correctly)
 *    not a mismatch — stamping it once would hide them for good.
 *
 * Everything here is a pure function of the cache arrays, so the decision is
 * unit-testable without a DB, and the caller re-evaluates it inside the
 * optimistic-lock attempt (a concurrent writer may add or clear lines between
 * reading the stamp and committing it).
 */
import { isLanguageTag, resolveTranslationLang } from './target-lang.ts';

/**
 * Folds a tag down to what identifies the language: its canonical form with
 * casing removed (`ZH-hant-tw` and `zh-Hant-TW` are one language). The tag must
 * already be well-formed — the pipeline rejects malformed values before this,
 * because `resolveTranslationLang` would otherwise silently fall back to the
 * default language and make junk compare equal to it.
 */
function langKey(tag: string): string {
  return resolveTranslationLang(tag).toLowerCase();
}

export type TranslationLangStampDecision =
  | {
    /** Keep the stored stamp (or keep it unset) — the cache is NOT all one language. */
    stamp: false;
    /**
     * Why: `mixed` — a non-empty line was not written in this save (it is in
     * the stored language, which the user still has to re-translate);
     * `unknown` — the stored stamp is unusable, so nothing can be compared.
     */
    reason: 'mixed' | 'unknown';
  }
  | {
    /**
     * Write this tag. `null` = leave the column unset: the merge emptied the
     * cache, so there is no language left to record (and the stamp must not
     * outlive its content).
     */
    stamp: string | null;
    reason: 'all_lines_stamped' | 'empty_cache';
  };

/**
 * Decide the language stamp for a merged cache.
 *
 * @param merged          The cache about to be written (index-aligned lines).
 * @param editedIndices   Line indices this save wrote.
 * @param targetLang      The language this save was made in; empty/absent means
 *                        the caller could not resolve a target (no config), in
 *                        which case nothing is stamped — unchanged behaviour.
 * @param storedLang      The stamp currently stored on the row.
 * @param assumeStoredLang
 *   The stored stamp is to be trusted for the lines this save did not touch.
 *   True for a user-driven save, because those lines are shown to the user and
 *   stay editable (#394); FALSE for AI output merged under the lock, which may
 *   have translated untouched lines into the new language without a stamp of
 *   its own — there, "not edited here" proves nothing.
 */
export function decideTranslationLangStamp(opts: {
  merged: readonly string[];
  editedIndices: ReadonlySet<number>;
  targetLang: string | null | undefined;
  storedLang: string | null | undefined;
  assumeStoredLang: boolean;
}): TranslationLangStampDecision {
  const target = String(opts.targetLang ?? '').trim();
  const stored = String(opts.storedLang ?? '').trim();
  const storedIsTag = isLanguageTag(stored);

  // A stamp may only speak for lines this save did not write when it NAMES the
  // same language (on both kinds of save), or when nothing is recorded at all
  // and the user is the one saving (`assumeStoredLang` — see above).
  const sameLanguage = storedIsTag && langKey(stored) === langKey(target);
  const assumedUnlabelled = opts.assumeStoredLang === true && stored === '';
  const untouchedKnown = sameLanguage || assumedUnlabelled;

  // Untouched lines that carry text are the ones whose language this save cannot
  // vouch for: a blank line carries no language at all, and a line this save
  // wrote is in `target` by definition.
  const hasUntouchedText = opts.merged.some((line, index) => (
    String(line ?? '').trim() !== '' && !opts.editedIndices.has(index)
  ));

  // A user-driven save may treat untouched lines as readable (they are on
  // screen); an AI merge cannot, whatever the stored stamp says — those lines
  // may be in another language the stamp never recorded.
  if (hasUntouchedText && !(untouchedKnown && opts.assumeStoredLang === true)) {
    // `mixed`: a stored stamp names another language, so whoever reads it can
    // re-translate. `unknown`: nothing usable is recorded (the column is empty
    // or holds junk), so the cache is merely unlabelled — and an unrecorded
    // stamp is deliberately NOT a mismatch on the client, so inventing one here
    // would hide those lines for good.
    return { stamp: false, reason: storedIsTag ? 'mixed' : 'unknown' };
  }

  if (!target) {
    // No resolved target (no translation config at all): never fabricate one.
    return { stamp: false, reason: storedIsTag ? 'mixed' : 'unknown' };
  }

  // Every non-empty line is in `target`, so the stamp is truthful now: unset
  // becomes set, a stale value gets corrected, a correct one is refreshed. An
  // emptied cache records nothing — the stamp must not outlive its content.
  const hasText = opts.merged.some((line) => String(line ?? '').trim() !== '');
  if (!hasText) return { stamp: null, reason: 'empty_cache' };
  return { stamp: target, reason: 'all_lines_stamped' };
}

/** Per-line record of what a save did — computed once in the lock attempt. */
export function editedLineIndices(edits: readonly { index: number }[]): Set<number> {
  return new Set(edits.map((edit) => edit.index));
}

/**
 * The `mixed_translation_lang` response flag: the stored cache is known to hold
 * lines that are NOT in the current target language. Optional on the wire — the
 * proofreading save keeps working against an older server, and a client that
 * ignores it still gets the correct (preserved) stamp.
 */
export function isMixedTranslationLang(
  storedLang: string | null | undefined,
  targetLang: string | null | undefined,
): boolean {
  const stored = (storedLang ?? '').trim();
  const target = (targetLang ?? '').trim();
  if (!isLanguageTag(stored) || !isLanguageTag(target)) return false;
  return langKey(stored) !== langKey(target);
}
