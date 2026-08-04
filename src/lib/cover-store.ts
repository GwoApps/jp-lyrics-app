import { getDB, schema, sql } from '@/lib/db';
import { eq } from 'drizzle-orm';

/**
 * Cover artwork storage, abstracted across backends:
 *
 * - Cloudflare Workers: R2 object storage (COVER_R2_BUCKET binding) —
 *   no D1 row-size limits, no BLOB bloat in the database.
 * - Local/SQLite deployments: BLOB in the song_covers table.
 *
 * The cover-image route serves whichever backend is active, so cover_url
 * semantics are identical everywhere and the client never changes.
 * R2 keys: covers/<songId> (content type stored as HTTP metadata).
 */

export interface CoverObject {
  mime: string;
  bytes: ArrayBuffer;
}

interface R2BucketLike {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream | null; httpMetadata?: { contentType?: string } } | null>;
  delete(key: string): Promise<unknown>;
}

const KEY_PREFIX = 'covers/';

/** Resolve the R2 binding on Cloudflare; null on local/SQLite backends. */
async function getR2Bucket(): Promise<R2BucketLike | null> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const ctx = await getCloudflareContext({ async: true });
    const bucket = (ctx.env as Record<string, unknown>).COVER_R2_BUCKET as R2BucketLike | undefined;
    return bucket ?? null;
  } catch {
    return null;
  }
}

function toArrayBuffer(value: unknown): ArrayBuffer {
  let u8: Uint8Array;
  if (value instanceof Uint8Array) u8 = value;
  else if (value instanceof ArrayBuffer) u8 = new Uint8Array(value);
  else if (Array.isArray(value)) u8 = new Uint8Array(value);
  else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) u8 = new Uint8Array(value);
  else throw new Error('unexpected blob type');
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

/** Store a cover: R2 on Cloudflare, SQLite BLOB elsewhere. */
export async function putCover(songId: string, mime: string, bytes: ArrayBuffer): Promise<void> {
  const r2 = await getR2Bucket();
  if (r2) {
    await r2.put(`${KEY_PREFIX}${songId}`, bytes, { httpMetadata: { contentType: mime } });
    return;
  }
  const db = getDB();
  await db.insert(schema.songCovers).values({
    songId,
    mime,
    data: bytes,
    updatedAt: sql`(datetime('now', 'localtime'))`,
  }).onConflictDoUpdate({
    target: schema.songCovers.songId,
    set: {
      mime,
      data: bytes,
      updatedAt: sql`(datetime('now', 'localtime'))`,
    },
  }).run();
}

/**
 * Read a cover. On Cloudflare the R2 object is primary; a miss falls back
 * to the SQLite BLOB so covers uploaded before R2 was wired up still serve.
 */
export async function getCover(songId: string): Promise<CoverObject | null> {
  const r2 = await getR2Bucket();
  if (r2) {
    const obj = await r2.get(`${KEY_PREFIX}${songId}`);
    if (obj?.body) {
      const bytes = await new Response(obj.body).arrayBuffer();
      return { mime: obj.httpMetadata?.contentType ?? 'image/jpeg', bytes };
    }
  }
  const db = getDB();
  const row = await db.select({
    mime: schema.songCovers.mime,
    data: schema.songCovers.data,
  }).from(schema.songCovers).where(eq(schema.songCovers.songId, songId)).get();
  if (!row) return null;
  return { mime: row.mime, bytes: toArrayBuffer(row.data) };
}

/** Remove a cover from whichever backend is active (both, on CF). */
export async function deleteCover(songId: string): Promise<void> {
  const r2 = await getR2Bucket();
  if (r2) {
    await r2.delete(`${KEY_PREFIX}${songId}`);
  }
  const db = getDB();
  await db.delete(schema.songCovers).where(eq(schema.songCovers.songId, songId)).run();
}
