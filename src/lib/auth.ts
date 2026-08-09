import { NextRequest } from 'next/server';
import { getDB, schema, eq } from '@/lib/db';
import { verifySession } from '@/lib/session-token';

export { signSession, SESSION_MAX_AGE } from '@/lib/session-token';

export interface AuthUser {
  id: string;       // user identifier (spotify:<id> or email)
  email: string;    // same as id, kept for backward compat
  name: string;
  role: string;     // 'admin' or 'user'
  isAdmin: boolean;
  isBlocked: boolean;
}

const COOKIE_NAME = 'jplrc_session';

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
  } catch (error) {
    // Fail closed: authentication cannot be trusted if its authority store is unavailable.
    console.error(`[auth] role lookup failed — ${error instanceof Error ? error.message : String(error)}`);
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
