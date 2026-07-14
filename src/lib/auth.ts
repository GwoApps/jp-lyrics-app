import { NextRequest } from 'next/server';
import { getDB, schema, eq } from '@/lib/db';

export interface AuthUser {
  id: string;       // user identifier (spotify:<id> or email)
  email: string;    // same as id, kept for backward compat
  name: string;
  role: string;     // 'admin' or 'user'
  isAdmin: boolean;
  isBlocked: boolean;
}

const COOKIE_NAME = 'jplrc_session';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

/**
 * Derive signing key from SESSION_SECRET or SPOTIFY_CLIENT_SECRET.
 * Uses Web Crypto API — works on Node.js and Cloudflare Workers.
 */
async function getSigningKey(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET || process.env.SPOTIFY_CLIENT_SECRET || 'jplrc-fallback';
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/**
 * Sign a user id into a cookie value: `id.timestamp.base64url(hmac)`
 */
export async function signSession(userId: string): Promise<string> {
  const ts = Math.floor(Date.now() / 1000);
  const payload = `${userId}.${ts}`;
  const key = await getSigningKey();
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${payload}.${sigB64}`;
}

/**
 * Verify a session cookie value and return the user id if valid.
 * Returns null if tampered, expired, or malformed.
 */
async function verifySession(token: string): Promise<string | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [userId, tsStr, sigB64] = parts;
  const ts = parseInt(tsStr, 10);
  if (!userId || isNaN(ts)) return null;

  // Check expiry
  const now = Math.floor(Date.now() / 1000);
  if (now - ts > SESSION_MAX_AGE) return null;

  // Verify signature
  const payload = `${userId}.${ts}`;
  const key = await getSigningKey();
  // Restore standard base64
  const sigPadded = sigB64.replace(/-/g, '+').replace(/_/g, '/')
    + '==='.slice((sigB64.length + 3) % 4);
  const sigBytes = Uint8Array.from(atob(sigPadded), c => c.charCodeAt(0));
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payload));
  return valid ? userId : null;
}

/**
 * Load the current authorization flags from the canonical users table.
 * A signed cookie alone is insufficient: deleted, blocked, or unregistered users
 * must not be allowed to execute protected API logic.
 */
async function getUserStatus(userId: string): Promise<{ isAdmin: boolean; isBlocked: boolean } | null> {
  try {
    const db = getDB();
    const row = await db.select({
      isAdmin: schema.users.isAdmin,
      isBlocked: schema.users.isBlocked,
    }).from(schema.users).where(eq(schema.users.id, userId)).get();
    if (!row) return null;
    return { isAdmin: row.isAdmin === 1, isBlocked: row.isBlocked === 1 };
  } catch {
    // Fail closed: authentication cannot be trusted if its authority store is unavailable.
    return null;
  }
}

/**
 * Extract authenticated user from signed session cookie.
 * Auth is exclusively via Spotify OAuth — the cookie is set during /api/auth/callback.
 */
export async function getAuthUser(request: NextRequest): Promise<AuthUser | null> {
  const cookie = request.cookies.get(COOKIE_NAME)?.value;
  if (!cookie) return null;

  const userId = await verifySession(cookie);
  if (!userId) return null;

  const status = await getUserStatus(userId);
  if (!status || status.isBlocked) return null;

  return { id: userId, email: userId, name: '', role: status.isAdmin ? 'admin' : 'user', isAdmin: status.isAdmin, isBlocked: false };
}
