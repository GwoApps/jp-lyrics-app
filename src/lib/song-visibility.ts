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
 */
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
