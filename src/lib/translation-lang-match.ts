/**
 * "Is the stored translation in the language I actually asked for?" — the one
 * place that decides it for every client surface (issue #281).
 *
 * The server has always refused to serve a cache written for another target
 * language (`src/app/api/songs/[id]/translate/route.ts`), but the client
 * rendered that cache as if it were current: 「已翻译 N/N」, complete-looking
 * coverage, exports in the old language — with no hint at all. The detail page,
 * the export dialog and the share page read their verdict from here instead of
 * each re-deriving it.
 */
import { isLanguageTag, resolveTranslationLang } from './target-lang.ts';

export interface TranslationLangState {
  /** Trimmed stored tag (`songs.lyrics_translation_lang`); `''` when unrecorded. */
  storedLang: string;
  /** Trimmed effective target language; `''` while the settings lookup is pending. */
  targetLang: string;
  /**
   * The cache is in a *known* other language.
   *
   * An unrecorded stamp is deliberately NOT a mismatch: legacy rows and
   * hand-corrected caches predate the column, and flagging all of them would
   * nag users about translations that may well be correct — they are merely
   * unlabelled. Only a recorded, different language is actionable.
   */
  mismatch: boolean;
  /** Safe BCP-47 tag for rendering the stored translation. */
  lang: string;
}

export function translationLangState(
  storedLang: string | null | undefined,
  targetLang: string | null | undefined,
  hasCache: boolean,
): TranslationLangState {
  const stored = (storedLang ?? '').trim();
  const target = (targetLang ?? '').trim();
  return {
    storedLang: stored,
    targetLang: target,
    // Exact equality, same rule the translate route applies to decide whether
    // the cache is reusable — so the badge and the next request never disagree.
    // Both sides must be real tags: a malformed value in either column is a
    // data problem, not "the translation is in the wrong language".
    mismatch: hasCache && isLanguageTag(stored) && isLanguageTag(target) && stored !== target,
    lang: resolveTranslationLang(stored),
  };
}
