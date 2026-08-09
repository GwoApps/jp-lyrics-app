import { NextRequest, NextResponse } from 'next/server';
import { getDB, sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import {
  USER_ACTIONS,
  hasUnknownFields,
  parseStrictJson,
  userAuditSnapshot,
  validateAction,
  validateExpectedUpdatedAt,
  validateReason,
  writeAuditLog,
  type UserAction,
} from '@/lib/admin';

const ALLOWED_KEYS = new Set(['action', 'reason', 'expected_updated_at']);

interface UserRow {
  id: string;
  display_name: string;
  is_admin: number;
  is_blocked: number;
  blocked_reason: string;
  created_at: string;
  updated_at: string;
}

function loadUser(db: unknown, id: string): Promise<UserRow | undefined> {
  return (db as { get: (q: unknown) => Promise<UserRow | undefined> }).get(
    sql`SELECT id, display_name, is_admin, is_blocked, blocked_reason, created_at, updated_at FROM users WHERE id = ${id}`
  );
}

/**
 * PUT /api/admin/users/[id] — explicit, audited user actions (admin only).
 *
 *   { "action": "promote" | "demote" | "block" | "unblock",
 *     "reason": "...", "expected_updated_at": "..." }
 *
 * - Strict schema: unknown fields / illegal JSON / wrong action / over-long
 *   reason are rejected (400 invalid_*).
 * - Optimistic lock: mismatched `expected_updated_at` → 409 stale_resource.
 * - Last-admin guard: a `demote` only succeeds while at least one OTHER admin
 *   remains (atomic conditional UPDATE, not just a self-check).
 * - Self-protection: you cannot demote/block/delete yourself.
 * - Business update + audit row are committed atomically.
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

  const action = validateAction<UserAction>(USER_ACTIONS, body.action);
  if (!action) return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
  const reason = validateReason(body.reason);
  if ('error' in reason) return NextResponse.json(reason, { status: 400 });
  const expectedUpdatedAt = validateExpectedUpdatedAt(body.expected_updated_at);

  // Self-protection: you cannot demote or block yourself.
  if (id === user.id) {
    if (action === 'demote') return NextResponse.json({ error: 'cannot_remove_own_admin' }, { status: 400 });
    if (action === 'block') return NextResponse.json({ error: 'cannot_block_self' }, { status: 400 });
  }

  const existing = await loadUser(db, id);
  if (!existing) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
  }

  const before = userAuditSnapshot(existing);
  const lockSql = expectedUpdatedAt ? sql`AND updated_at = ${expectedUpdatedAt}` : sql``;

  const result = await db.transaction(async (tx: unknown) => {
    const run = (tx as { run: (q: unknown) => Promise<unknown> }).run;
    let sqlUpdate: ReturnType<typeof sql>;
    if (action === 'promote') {
      sqlUpdate = sql`UPDATE users SET is_admin = 1, updated_at = datetime('now', 'localtime') WHERE id = ${id} ${lockSql}`;
    } else if (action === 'demote') {
      // Atomic last-admin guard: only demote when another admin remains.
      sqlUpdate = sql`UPDATE users
          SET is_admin = 0, updated_at = datetime('now', 'localtime')
          WHERE id = ${id} ${lockSql}
            AND (SELECT COUNT(*) FROM users WHERE id <> ${id} AND is_admin = 1) >= 1`;
    } else if (action === 'block') {
      sqlUpdate = sql`UPDATE users
          SET is_blocked = 1, blocked_reason = ${reason.reason}, updated_at = datetime('now', 'localtime')
          WHERE id = ${id} ${lockSql}`;
    } else {
      sqlUpdate = sql`UPDATE users
          SET is_blocked = 0, blocked_reason = '', updated_at = datetime('now', 'localtime')
          WHERE id = ${id} ${lockSql}`;
    }

    const updated = await run(sqlUpdate);
    const changed = Number(
      (updated as { rowsAffected?: number; meta?: { changes?: number } }).rowsAffected
        ?? (updated as { meta?: { changes?: number } }).meta?.changes
        ?? 0
    );
    if (changed === 0) {
      // Distinguish: stale write / last-admin guard rejection / benign no-op.
      const current = await (tx as { get: (q: unknown) => Promise<UserRow | undefined> }).get(
        sql`SELECT id, display_name, is_admin, is_blocked, blocked_reason, created_at, updated_at FROM users WHERE id = ${id}`
      );
      if (!current) return { stale: true };
      if (expectedUpdatedAt && current.updated_at !== expectedUpdatedAt) return { stale: true };
      // Demote that would remove the only remaining admin is refused atomically.
      if (action === 'demote' && current.is_admin === 1) {
        const otherAdmins = await (tx as { get: (q: unknown) => Promise<{ n: number } | undefined> }).get(
          sql`SELECT COUNT(*) AS n FROM users WHERE id <> ${id} AND is_admin = 1`
        );
        if (Number(otherAdmins?.n ?? 0) === 0) return { lastAdmin: true };
      }
      return { stale: false, after: current };
    }

    const after = await (tx as { get: (q: unknown) => Promise<UserRow | undefined> }).get(
      sql`SELECT id, display_name, is_admin, is_blocked, blocked_reason, created_at, updated_at FROM users WHERE id = ${id}`
    );
    await writeAuditLog(tx, {
      actorUserId: user.id,
      action,
      targetType: 'user',
      targetId: id,
      beforeJson: JSON.stringify(before),
      afterJson: after ? JSON.stringify(userAuditSnapshot(after)) : null,
      reason: reason.reason,
    });
    return { stale: false, after };
  });

  if (result.stale) {
    return NextResponse.json({ error: 'stale_resource' }, { status: 409 });
  }
  if ('lastAdmin' in result && result.lastAdmin) {
    return NextResponse.json({ error: 'last_admin' }, { status: 400 });
  }
  if (!result.after) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
  }
  return NextResponse.json(result.after);
}

// DELETE /api/admin/users/[id] — delete user and their data (admin only, audited).
// Returns the cascade impact so the UI can show what was removed.
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

  // Self-protection: admin can't delete themselves.
  if (id === user.id) {
    return NextResponse.json({ error: 'cannot_delete_self' }, { status: 400 });
  }

  const existing = await loadUser(db, id);
  if (!existing) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
  }

  const impact = await db.transaction(async (tx: unknown) => {
    const run = (tx as { run: (q: unknown) => Promise<unknown> }).run;
    const rows = await (tx as { all: (q: unknown) => Promise<Array<Record<string, unknown>>> }).all(
      sql`SELECT
        (SELECT COUNT(*) FROM songs WHERE created_by = ${id}) AS songs,
        (SELECT COUNT(*) FROM favorites WHERE user_email = ${id}) AS favorites,
        (SELECT COUNT(*) FROM collections WHERE user_email = ${id}) AS collections`
    );
    await run(sql`DELETE FROM spotify_auth WHERE user_email = ${id}`);
    await run(sql`DELETE FROM favorites WHERE user_email = ${id}`);
    await run(sql`DELETE FROM collection_songs WHERE collection_id IN (SELECT id FROM collections WHERE user_email = ${id})`);
    await run(sql`DELETE FROM collections WHERE user_email = ${id}`);
    await run(sql`DELETE FROM songs WHERE created_by = ${id}`);
    await run(sql`DELETE FROM users WHERE id = ${id}`);
    await writeAuditLog(tx, {
      actorUserId: user.id,
      action: 'delete_user',
      targetType: 'user',
      targetId: id,
      beforeJson: JSON.stringify(userAuditSnapshot(existing)),
      afterJson: null,
      reason: '',
    });
    const counts = rows[0] ?? {};
    return {
      songs: Number(counts.songs ?? 0),
      favorites: Number(counts.favorites ?? 0),
      collections: Number(counts.collections ?? 0),
    };
  });

  return NextResponse.json({ success: true, ...impact });
}
