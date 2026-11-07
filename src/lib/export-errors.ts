/**
 * Maps export-endpoint error codes to i18n keys so the download dialog can
 * show a localized message instead of saving the error body as a file.
 */
export const EXPORT_ERROR_KEYS: Record<string, string> = {
  song_not_found: 'song.exportSongNotFound',
  lrc_no_synced_lyrics: 'song.exportLrcUnavailable',
  login_required: 'apiErrors.loginRequired',
  unauthorized: 'apiErrors.loginRequired',
  forbidden: 'apiErrors.forbidden',
};

export function exportErrorMsg(
  t: (k: string) => string,
  code: string | undefined,
  fallbackKey = 'song.exportFailed',
): string {
  const key = typeof code === 'string' ? EXPORT_ERROR_KEYS[code] : undefined;
  return key ? t(key) : t(fallbackKey);
}
