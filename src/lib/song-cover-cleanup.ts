/**
 * Song deletion must also drop the cover object. On Cloudflare covers live in
 * R2, outside SQLite, so the `song_covers` FK cascade alone leaves an orphan;
 * on local/SQLite deployments the BLOB is in that cascaded table and this is
 * effectively a no-op.
 *
 * Cleanup is best-effort: a missing bucket or a transient R2 failure must
 * never turn a successful song deletion into an error.
 */
import { deleteCover } from '@/lib/cover-store';

export async function cleanupSongCover(songId: string): Promise<void> {
  try {
    await deleteCover(songId);
  } catch (error) {
    console.warn(
      `[song-cover] cleanup failed for ${songId} — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
