import { NextRequest } from 'next/server';
import { getDB, schema, sql } from '@/lib/db';

export interface AuthUser {
  id: string;       // user identifier (spotify:id or email)
  email: string;    // same as id for backward compat
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
 * Sign an email into a cookie value: `email.timestamp.base64url(hmac)`
 */
export async function signSession(email: string): Promise<string> {
  const ts = Math.floor(Date.now() / 1000);
  const payload = `${email}.${ts}`;
  const key = await getSigningKey();
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${payload}.${sigB64}`;
}

/**
 * Verify a session cookie value and return the email if valid.
 * Returns null if tampered, expired, or malformed.
 */
async function verifySession(token: string): Promise<string | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [email, tsStr, sigB64] = parts;
  const ts = parseInt(tsStr, 10);
  if (!email || isNaN(ts)) return null;

  // Check expiry
  const now = Math.floor(Date.now() / 1000);
  if (now - ts > SESSION_MAX_AGE) return null;

  // Verify signature
  const payload = `${email}.${ts}`;
  const key = await getSigningKey();
  // Restore standard base64
  const sigPadded = sigB64.replace(/-/g, '+').replace(/_/g, '/')
    + '==='.slice((sigB64.length + 3) % 4);
  const sigBytes = Uint8Array.from(atob(sigPadded), c => c.charCodeAt(0));
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payload));
  return valid ? email : null;
}

/**
 * Query the users table for admin/blocked status.
 * Returns { isAdmin, isBlocked } or defaults if user not found.
 */
async function getUserStatus(userId: string): Promise<{ isAdmin: boolean; isBlocked: boolean }> {
  try {
    const db = getDB();
    const row = await db.get(
      sql`SELECT is_admin, is_blocked FROM users WHERE id = ${userId}`
    ) as { is_admin: number; is_blocked: number } | undefined;
    if (row) {
      return { isAdmin: row.is_admin === 1, isBlocked: row.is_blocked === 1 };
    }
  } catch { /* users table may not exist yet */ }
  return { isAdmin: false, isBlocked: false };
}

/**
 * Extract authenticated user from:
 *   1. kazusa-auth forward headers (X-User-Email etc.) — gateway mode
 *   2. Signed session cookie — standalone / Cloudflare Workers mode
 *
 * Header takes precedence (gateway deployments are the canonical auth source).
 */
export async function getAuthUser(request: NextRequest): Promise<AuthUser | null> {
  // 1. Gateway headers (kazusa-home-portal)
  const headerEmail = request.headers.get('X-User-Email');
  if (headerEmail) {
    // Use email (not X-User-Id) as user key — X-User-Id is the gateway's
    // database auto-increment, not the same identifier used in jplrc's users table
    const { isAdmin, isBlocked } = await getUserStatus(headerEmail);
    if (isBlocked) return null;
    return {
      id: headerEmail,
      email: headerEmail,
      name: decodeURIComponent(request.headers.get('X-User-Name') || ''),
      role: isAdmin ? 'admin' : (request.headers.get('X-User-Role') || 'user'),
      isAdmin,
      isBlocked,
    };
  }

  // 2. Session cookie (standalone / CF Workers)
  const cookie = request.cookies.get(COOKIE_NAME)?.value;
  if (cookie) {
    const email = await verifySession(cookie);
    if (email) {
      const { isAdmin, isBlocked } = await getUserStatus(email);
      if (isBlocked) return null;
      return { id: email, email, name: '', role: isAdmin ? 'admin' : 'user', isAdmin, isBlocked };
    }
  }

  return null;
}
