/**
 * Maps the language-neutral lyrics-provider error codes to i18n keys so the
 * admin console can show a localized reason for every failure the server can
 * report (ISSUE #303).
 *
 * Client-safe by design: this module only holds a static lookup table and must
 * never import `./db` (or anything that reaches the database), so both the
 * admin API and the client components can share it.
 *
 * Never build a key by transforming the code (`admin.lyricsProviderError${…}`):
 * the dictionary keys are camelCase while the codes are snake_case, so derived
 * keys silently miss and the raw key leaks into the UI. Look codes up here and
 * fall back to a generic message for unknown codes.
 *
 * Keep every key in sync with the four locale dictionaries
 * (src/i18n/{ja,en,zh-CN,zh-TW}.json): error-keys.test.ts asserts that each
 * entry resolves to a real, human-readable value in all four locales.
 */

/** Every code saved by `POST /api/admin/lyrics-providers` and PUT `/:id`. */
export const LYRICS_PROVIDER_SAVE_ERROR_KEYS: Record<string, string> = {
  // Body validation.
  invalid_name: 'admin.lyricsProviderErrorInvalidName',
  invalid_base_url: 'admin.lyricsProviderErrorInvalidBaseUrl',
  invalid_fields: 'admin.lyricsProviderErrorInvalidFields',
  // Builtin / HTTP transport field ownership.
  builtin_readonly_field: 'admin.lyricsProviderErrorBuiltinReadonlyField',
  http_provider_readonly_field: 'admin.lyricsProviderErrorHttpProviderReadonlyField',
  // Builtin sources cannot be deleted, only disabled.
  builtin_undeletable: 'admin.lyricsProviderErrorBuiltinUndeletable',
  // Bearer token storage.
  secret_key_not_configured: 'admin.lyricsProviderErrorSecretKeyNotConfigured',
  auth_secret_required: 'admin.lyricsProviderErrorAuthSecretRequired',
  // Builtin source_config validation.
  invalid_source_config: 'admin.lyricsProviderErrorInvalidSourceConfig',
  invalid_source_schema: 'admin.lyricsProviderErrorInvalidSourceSchema',
  // Deployment network policy (`validateProviderBaseUrl`, shared with the
  // source_config URL fields).
  http_disallowed: 'admin.lyricsProviderErrorHttpDisallowed',
  unsafe_host: 'admin.lyricsProviderErrorUnsafeHost',
  metadata_forbidden: 'admin.lyricsProviderErrorMetadataForbidden',
  dns_failed: 'admin.lyricsProviderErrorDnsFailed',
  // `invalid_url` and the create-only `invalid_base_url` collapse into the
  // base-URL message: both tell the admin to fix the same field.
  invalid_url: 'admin.lyricsProviderErrorInvalidBaseUrl',
};

/**
 * Codes reported by `POST /api/admin/lyrics-providers/:id/test` and by the
 * persisted manifest health check (`row.last_check_code`): the policy codes
 * above plus the manifest fetch/parse failures from `http-client.ts`.
 */
export const LYRICS_PROVIDER_TEST_ERROR_KEYS: Record<string, string> = {
  ...LYRICS_PROVIDER_SAVE_ERROR_KEYS,
  // The endpoint is HTTP-plugin-only, so a builtin row can only get here by
  // calling the API directly — fall back to the generic test-failure message.
  builtin_no_manifest: 'admin.lyricsProviderTestFail',
  // Manifest fetch failures.
  invalid_response: 'admin.lyricsProviderErrorInvalidResponse',
  protocol_mismatch: 'admin.lyricsProviderErrorProtocolMismatch',
  protocol_version: 'admin.lyricsProviderErrorProtocolVersion',
  timeout: 'admin.lyricsProviderErrorTimeout',
  // Manifest search statuses (HTTP status / code mapping).
  empty: 'admin.lyricsProviderErrorEmpty',
  invalid_request: 'admin.lyricsProviderErrorInvalidRequest',
  auth_failed: 'admin.lyricsProviderErrorAuthFailed',
  rate_limited: 'admin.lyricsProviderErrorRateLimited',
  temporary_unavailable: 'admin.lyricsProviderErrorTemporaryUnavailable',
  error: 'admin.lyricsProviderErrorGeneric',
};

/** Codes sent by the save endpoints plus `invalid_url` from the policy guard. */
export const LYRICS_PROVIDER_SAVE_ERROR_CODES: readonly string[] = Object.freeze(
  Object.keys(LYRICS_PROVIDER_SAVE_ERROR_KEYS),
);

/** Codes a connection test / manifest health check can report. */
export const LYRICS_PROVIDER_TEST_ERROR_CODES: readonly string[] = Object.freeze(
  Object.keys(LYRICS_PROVIDER_TEST_ERROR_KEYS),
);

/**
 * i18n key for a failed save, or null when the code is unknown/absent so the
 * caller can fall back to its generic message (never to the raw code or key).
 */
export function lyricsProviderSaveErrorKey(code?: string | null): string | null {
  if (!code) return null;
  return LYRICS_PROVIDER_SAVE_ERROR_KEYS[code] ?? null;
}

/**
 * i18n key for a failed connection test / health check, or null when the code
 * is unknown/absent so the caller can fall back to `admin.lyricsProviderTestFail`.
 */
export function lyricsProviderTestErrorKey(code?: string | null): string | null {
  if (!code) return null;
  return LYRICS_PROVIDER_TEST_ERROR_KEYS[code] ?? null;
}
