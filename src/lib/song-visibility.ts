/**
 * Song visibility / ACL helpers.
 *
 * The canonical rule (mirrored by GET /api/songs/[id]) is:
 *   a song is visible to a user iff  is_public = 1  OR  created_by = current user  OR  admin.
 *
 * Every read path that can return song metadata (single song, export, collection
 * listing, favorite state, cover image) must apply this rule — otherwise a
 * logged-in user who learns a private song's UUID can read its metadata through
 * a secondary endpoint and bypass the 404 returned by the single-song API.
 *
 * `isSongVisibleToUser` is that rule in TypeScript (for rows already in memory).
 * `songVisibilityWhere` is the SAME rule as a SQL predicate, so list queries
 * never hand-roll their own copy of the condition and drift apart (ISSUE #346:
 * the default and `?q=` branches of GET /api/songs were still `is_public = 1`,
 * hiding a non-admin's own songs that `?mine=1`, `/api/collections/[id]/songs`
 * and `/api/spotify/match-song` happily returned).
 *
 * The predicate is TOTAL — it never returns `undefined`. Every caller
 * interpolates it straight into a raw SQL template (`WHERE ${and(...)}`), and
 * drizzle renders an interpolated `undefined` as the empty string, so an
 * `undefined` admin predicate used to produce `WHERE \n ORDER BY` → SQLite
 * `syntax error near "ORDER"` → HTTP 500 for the whole song list (admin-only,
 * since only admins got `undefined`). Returning the tautology `1 = 1` for the
 * unrestricted viewer keeps those templates valid by construction.
 */
import { eq, or, sql, type SQL } from 'drizzle-orm';
import { songs } from './schema.ts';
import type { AuthUser } from '@/lib/auth';

/** Minimal fields needed for a visibility check. */
export interface SongVisibilityFields {
  is_public?: number;
  isPublic?: number;
  created_by?: string;
  createdBy?: string;
}

/**
 * Decide whether `song` is readable by `user`.
 * - Missing / null song → not visible (caller maps to 404).
 * - is_public = 1 → visible to everyone (anonymous included).
 * - Otherwise only the owner or an admin may see it.
 */
export function isSongVisibleToUser(
  song: SongVisibilityFields | null | undefined,
  user: Pick<AuthUser, 'id' | 'isAdmin'> | null | undefined,
): boolean {
  if (!song) return false;
  const isPublic = song.isPublic ?? song.is_public;
  if (isPublic === 1) return true;
  if (!user) return false;
  if (user.isAdmin) return true;
  const createdBy = song.createdBy ?? song.created_by;
  return createdBy === user.id;
}

/** Viewer of a song list query — the subset of AuthUser the ACL needs. */
export interface SongViewer {
  email?: string | null;
  isAdmin?: boolean | null;
}

/** SQL column names accepted by `songVisibilityWhere`. */
export interface SongVisibilityColumns {
  /** Column holding the `is_public` flag. */
  isPublic: unknown;
  /** Column holding the owner's email. */
  createdBy: unknown;
}

const SONGS_COLUMNS: SongVisibilityColumns = {
  isPublic: songs.isPublic,
  createdBy: songs.createdBy,
};

/** For raw queries using `FROM songs s`; the unaliased schema columns are invalid there. */
export const SONGS_S_COLUMNS: SongVisibilityColumns = {
  isPublic: sql`s.is_public`,
  createdBy: sql`s.created_by`,
};

/**
 * The canonical visibility rule as a SQL predicate (no leading AND):
 *
 *   is_public = 1 OR created_by = <viewer email>      (logged-in non-admin)
 *   is_public = 1                                     (anonymous)
 *   1 = 1                                             (admin — no restriction)
 *
 * The anonymous branch is `is_public = 1` EXACTLY (never an unbound
 * `created_by = ''`): a legacy row whose `created_by` is empty/NULL must not
 * become visible to logged-out visitors.
 *
 * Always returns an `SQL` chunk (never `undefined`) so callers can AND it into
 * their WHERE clause unconditionally. See the header comment for why an
 * `undefined` admin predicate broke every raw-SQL caller.
 */
export function songVisibilityWhere(
  viewer: SongViewer | null | undefined,
  columns: SongVisibilityColumns = SONGS_COLUMNS,
): SQL {
  if (viewer?.isAdmin) return sql`1 = 1`;
  const publicOnly = sql`${columns.isPublic as never} = 1`;
  const viewerEmail = viewer?.email;
  if (!viewerEmail) return publicOnly;
  return or(publicOnly, eq(columns.createdBy as never, viewerEmail)) ?? publicOnly;
}
