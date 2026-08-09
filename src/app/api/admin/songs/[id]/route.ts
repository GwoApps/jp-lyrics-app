import { NextRequest, NextResponse } from 'next/server';
import { getDB, sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import {
  SONG_ACTIONS,
  hasUnknownFields,
  parseStrictJson,
  songAuditSnapshot,
  validateAction,
  validateExpectedUpdatedAt,
  validateReason,
  writeAuditLog,
  type SongAction,
} from '@/lib/admin';

const ALLOWED_KEYS = new Set(['action', 'reason', 'expected_updated_at']);

interface SongRow {
  id: string;
  title: string;
  artist: string;
  is_public: number;
  public_requested: number;
  updated_at: string;
}

/**
 * PUT /api/admin/songs/[id] — explicit, audited moderation actions (admin only).
 *
 *   { "action": "approve_public" | "reject_public" | "publish" | "unpublish",
 *     "reason": "...", "expected_updated_at": "..." }
 *
 * - Strict schema: unknown fields / illegal JSON / wrong action / over-long
 *   reason are rejected (400 invalid_*).
 * - Optimistic lock: when `expected_updated_at` mismatches, returns
 *   409 { error: 'stale_resource' } without writing.
 * - Business update + audit row are committed atomically (single transaction).
 * - Only `approve_public`/`reject_public` clear `public_requested` — the
 *   generic visibility actions never bypass the review workflow.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const db = getDB();
  const { id } = await params;
  const body = await parseStrictJson(request);
  if ('error' in body) return NextResponse.json(body, { status: 400 });
  if (hasUnknownFields(body, ALLOWED_KEYS)) {
    return NextResponse.json({ error: 'invalid_fields' }, { status: 400 });
  }

  const action = validateAction<SongAction>(SONG_ACTIONS, body.action);
  if (!action) return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
  const reason = validateReason(body.reason);
  if ('error' in reason) return NextResponse.json(reason, { status: 400 });
  const expectedUpdatedAt = validateExpectedUpdatedAt(body.expected_updated_at);

  const existing = await db.get(
    sql`SELECT id, title, artist, is_public, public_requested, updated_at FROM songs WHERE id = ${id}`
  ) as SongRow | undefined;
  if (!existing) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }

  // Approve/reject only make sense for songs currently in the pending queue.
  if ((action === 'approve_public' || action === 'reject_public') && existing.public_requested !== 1) {
    return NextResponse.json({ error: 'not_pending_approval' }, { status: 400 });
  }
  // Undo approve: the song must be public and have been approved (i.e. not
  // requested again by the owner). It returns the song to the pending queue.
  if (action === 'undo_approve' && existing.is_public !== 1) {
    return NextResponse.json({ error: 'not_approved' }, { status: 400 });
  }

  const before = songAuditSnapshot(existing);
  const isUndo = action === 'undo_approve';
  const nextIsPublic = !isUndo && (action === 'approve_public' || action === 'publish') ? 1 : 0;
  const clearRequest = action === 'approve_public' || action === 'reject_public';
  const nextRequested = isUndo ? 1 : clearRequest ? 0 : existing.public_requested;

  const lockSql = expectedUpdatedAt ? sql`AND updated_at = ${expectedUpdatedAt}` : sql``;

  const result = await db.transaction(async (tx: unknown) => {
    const updated = await (tx as { run: (q: unknown) => Promise<unknown> }).run(
      sql`UPDATE songs
          SET is_public = ${nextIsPublic},
              public_requested = ${nextRequested},
              updated_at = datetime('now', 'localtime')
          WHERE id = ${id} ${lockSql}`
    );
    const changed = Number(
      (updated as { rowsAffected?: number; meta?: { changes?: number } }).rowsAffected
        ?? (updated as { meta?: { changes?: number } }).meta?.changes
        ?? 0
    );
    if (changed === 0) {
      // A zero-row update is either a stale write (updated_at moved) or a
      // benign no-op (already in the target state). Re-read to disambiguate:
      // stale → 409; no-op → treat as success and keep the current row.
      const current = await (tx as { get: (q: unknown) => Promise<SongRow | undefined> }).get(
        sql`SELECT id, title, artist, is_public, public_requested, updated_at FROM songs WHERE id = ${id}`
      );
      if (!current) return { stale: true };
      if (expectedUpdatedAt && current.updated_at !== expectedUpdatedAt) return { stale: true };
      return { stale: false, after: current };
    }

    const after = await (tx as { get: (q: unknown) => Promise<SongRow | undefined> }).get(
      sql`SELECT id, title, artist, is_public, public_requested, updated_at FROM songs WHERE id = ${id}`
    );
    await writeAuditLog(tx, {
      actorUserId: user.id,
      action,
      targetType: 'song',
      targetId: id,
      beforeJson: JSON.stringify(before),
      afterJson: after ? JSON.stringify(songAuditSnapshot(after)) : null,
      reason: reason.reason,
    });
    return { stale: false, after };
  });

  if (result.stale) {
    return NextResponse.json({ error: 'stale_resource' }, { status: 409 });
  }
  if (!result.after) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }
  return NextResponse.json(result.after);
}

// DELETE /api/admin/songs/[id] — delete song (admin only, audited).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const db = getDB();
  const { id } = await params;

  const existing = await db.get(
    sql`SELECT id, title, artist, is_public, public_requested, updated_at FROM songs WHERE id = ${id}`
  ) as SongRow | undefined;
  if (!existing) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }

  await db.transaction(async (tx: unknown) => {
    await (tx as { run: (q: unknown) => Promise<unknown> }).run(sql`DELETE FROM songs WHERE id = ${id}`);
    await writeAuditLog(tx, {
      actorUserId: user.id,
      action: 'delete_song',
      targetType: 'song',
      targetId: id,
      beforeJson: JSON.stringify(songAuditSnapshot(existing)),
      afterJson: null,
    });
  });

  return NextResponse.json({ success: true });
}
