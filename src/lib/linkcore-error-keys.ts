/**
 * Maps the Linkcore import error codes (`POST /api/lyrics/linkcore`) to i18n
 * keys for the create-song form's import toast.
 *
 * Client-safe by design: a static table only, so the client component and its
 * tests can share it without pulling in cheerio or the fetch pipeline.
 *
 * Never derive a key from the code (`new.${code}`) — the route also answers
 * `login_required`, which has no `new.login_required` entry, so a derived key
 * renders the raw identifier in the toast (ISSUE #358). Unknown codes fall
 * back to the generic message at the call site, like
 * `src/lib/lyrics-provider/error-keys.ts` does.
 */

/** Every code `POST /api/lyrics/linkcore` can answer with. */
export const LINKCORE_ERROR_KEYS: Record<string, string> = {
  invalid_linkcore_url: 'new.invalid_linkcore_url',
  linkcore_fetch_failed: 'new.linkcore_fetch_failed',
  linkcore_invalid_content_type: 'new.linkcore_invalid_content_type',
  lyrics_not_found: 'new.lyrics_not_found',
  login_required: 'apiErrors.loginRequired',
};

/** Resolve an error code to its i18n key, or `null` for an unknown code. */
export function linkcoreErrorKey(code: string | undefined): string | null {
  return code && Object.hasOwn(LINKCORE_ERROR_KEYS, code) ? LINKCORE_ERROR_KEYS[code] : null;
}
