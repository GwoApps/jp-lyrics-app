/**
 * Maps translate-endpoint error codes to i18n keys so the client can show
 * a localized message for every failure the server can report.
 */
export const TRANSLATION_ERROR_KEYS: Record<string, string> = {
  login_required: 'apiErrors.loginRequired',
  forbidden: 'apiErrors.forbidden',
  translation_not_configured: 'song.translationUnavailable',
  empty_lyrics: 'song.translationEmptyLyrics',
  translation_failed: 'song.translationFailed',
  translation_invalid_response: 'song.translationFailed',
  ai_quota_exceeded: 'song.translationQuotaExceeded',
};
