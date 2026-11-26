/**
 * Anonymous identity key for offline song caching.
 *
 * Personalized song responses stay `private, no-store`: shared/CDN caches and
 * browser HTTP caches never persist them. The service worker may still keep a
 * local copy so a previously opened song can be read offline, but only under a
 * key derived from the signed session cookie this request carried. Anonymous
 * readers share one key; each signed-in account gets its own.
 *
 * The digest is computed server-side from an authenticated identity: the
 * signed-in user's id (which also reflects account status via `getAuthUser`),
 * or a fixed value for anonymous readers. The raw cookie is never sent to the
 * client — only this non-reversible digest, in a readable response header.
 */
export const OFFLINE_IDENTITY_HEADER = 'X-Offline-Identity';
const ANONYMOUS_IDENTITY = 'anon';

/** SHA-256 → stable base64url digest, computed with Web Crypto (Node + Workers). */
export async function deriveOfflineIdentity(userId: string | undefined): Promise<string> {
  if (!userId) return ANONYMOUS_IDENTITY;
  const bytes = new TextEncoder().encode(userId);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `u-${btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')}`;
}

/** Attach the identity header to a song response without changing its no-store policy. */
export function withOfflineIdentity<T extends Response>(response: T, userId: string | undefined): Promise<T> {
  return deriveOfflineIdentity(userId).then((identity) => {
    response.headers.set(OFFLINE_IDENTITY_HEADER, identity);
    return response;
  });
}
