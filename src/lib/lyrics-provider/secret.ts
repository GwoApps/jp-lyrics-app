/**
 * AES-GCM secret encryption for HTTP provider bearer tokens (ISSUE #148).
 *
 * Tokens are encrypted at rest using Web Crypto AES-GCM with a key derived from
 * the deployment-level env var LYRICS_PROVIDER_SECRET_KEY. When no key is
 * configured, bearer providers cannot be saved (only auth=none is allowed).
 *
 * The ciphertext is stored as `v1:<base64(iv)>:<base64(ciphertext)>`; the IV is
 * random per encryption. GET responses / audit logs never return the token.
 */

const KEY_ALGO = { name: 'AES-GCM', length: 256 };
const IV_LENGTH = 12;

/** Cached derived key, invalidated when LYRICS_PROVIDER_SECRET_KEY changes. */
let cachedKey: CryptoKey | null = null;
let cachedKeySecret: string | undefined;

export function hasProviderSecretKey(): boolean {
  return typeof process.env.LYRICS_PROVIDER_SECRET_KEY === 'string'
    && process.env.LYRICS_PROVIDER_SECRET_KEY.trim().length > 0;
}

async function deriveKey(): Promise<CryptoKey> {
  const secret = process.env.LYRICS_PROVIDER_SECRET_KEY!;
  // Reuse the derived key across calls as long as the secret is unchanged.
  // PBKDF2 with 100k iterations is expensive on Cloudflare Workers (CPU-time
  // sensitive) and runs on every provider decrypt; the derived CryptoKey is
  // deterministic per secret, so cache it module-level to avoid re-deriving
  // for every song × bearer-provider combination.
  if (cachedKey && cachedKeySecret === secret) return cachedKey;
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  // A fixed salt is acceptable here: the secret key itself is the deployment
  // secret; the salt simply diversifies the derived key deterministically.
  const salt = enc.encode('jplrc-provider-secret-v1');
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    material,
    KEY_ALGO,
    false,
    ['encrypt', 'decrypt'],
  );
  cachedKey = key;
  cachedKeySecret = secret;
  return key;
}

/** Encrypt a bearer token; returns null when no secret key is configured. */
export async function encryptProviderSecret(plaintext: string): Promise<string | null> {
  if (!plaintext || !hasProviderSecretKey()) return null;
  const key = await deriveKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const enc = new TextEncoder();
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext),
  );
  const ivB64 = Buffer.from(iv).toString('base64');
  const cipherB64 = Buffer.from(new Uint8Array(cipher)).toString('base64');
  return `v1:${ivB64}:${cipherB64}`;
}

/** Decrypt a stored token; returns null on any failure (corrupt / key mismatch). */
export async function decryptProviderSecret(stored: string): Promise<string | null> {
  if (!hasProviderSecretKey()) return null;
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  try {
    const key = await deriveKey();
    const iv = Buffer.from(parts[1], 'base64');
    const cipher = Buffer.from(parts[2], 'base64');
    const dec = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      cipher,
    );
    return new TextDecoder().decode(dec);
  } catch {
    return null;
  }
}

/** Mask a secret for display; returns null when the stored value is empty. */
export function maskSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (stored.length <= 8) return '••••';
  return `${stored.slice(0, 4)}...${stored.slice(-4)}`;
}
