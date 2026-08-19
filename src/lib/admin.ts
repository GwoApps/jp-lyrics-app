import { sql } from 'drizzle-orm';

// NOTE: `@/lib/db` is imported lazily (see listRecentAudit below) so this
// module stays importable under the node test runner, matching the pattern in
// src/lib/ai-usage.ts.

/**
 * Shared admin helpers: strict action schemas, optimistic-lock guards and the
 * append-only audit trail (ISSUE #82, safety P0).
 *
 * All admin writes go through a single `action` body instead of bare boolean
 * fields, reject unknown fields / illegal JSON / over-long reasons, and record
 * a whitelisted before/after snapshot in `admin_audit_log` atomically with the
 * business update.
 */

/** Hard cap for the optional reason string. */
export const MAX_REASON_LENGTH = 200;
/** Hard cap for the paged list APIs (limit=1..50). */
export const MAX_PAGE_LIMIT = 50;

/**
 * Reject cross-origin admin mutations (CSRF defence-in-depth, ISSUE #148).
 * The admin mutation endpoints call this BEFORE parsing the body or touching
 * any external provider. A present-but-mismatched `Origin` header is rejected;
 * a missing header (non-browser / same-origin fetch that omits it) is allowed,
 * since SameSite cookies already stop cross-site browser requests.
 * Returns true when the request may proceed.
 */
export function isSameOriginRequest(request: {
  headers: { get(name: string): string | null };
  nextUrl?: { host: string };
}): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return true; // non-browser client or server-to-server call
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false; // malformed Origin is not trusted
  }
  // Compare only the host portion; scheme differences (http/https) are ignored
  // so an HTTPS page calling an HTTP-internal host still matches.
  const requestHost = request.nextUrl?.host;
  if (requestHost) {
    return originUrl.host.toLowerCase() === requestHost.toLowerCase();
  }
  // Fall back to the Host header when nextUrl is unavailable.
  const hostHeader = request.headers.get('Host') ?? '';
  if (!hostHeader) return false;
  return originUrl.host.toLowerCase() === hostHeader.split(':')[0].toLowerCase() ||
    originUrl.host.toLowerCase() === hostHeader.toLowerCase();
}

export const USER_ACTIONS = ['promote', 'demote', 'block', 'unblock'] as const;
export type UserAction = (typeof USER_ACTIONS)[number];

export const SONG_ACTIONS = ['approve_public', 'reject_public', 'publish', 'unpublish', 'undo_approve'] as const;
export type SongAction = (typeof SONG_ACTIONS)[number];

export type AdminTargetType = 'user' | 'song' | 'translation_config' | 'lyrics_provider';

/** Allowed top-level body keys for the write endpoints — everything else is rejected. */
// (Kept inline at each route via hasUnknownFields; no shared constant needed.)

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Parse + validate a JSON body; returns an error string (language-neutral code) or null. */
export function parseStrictJson(request: { json: () => Promise<unknown> }): Promise<Record<string, unknown> | { error: string }> {
  return request.json().then((raw) => {
    if (!isPlainObject(raw)) return { error: 'invalid_json' };
    return raw as Record<string, unknown>;
  }).catch(() => ({ error: 'invalid_json' }));
}

export function validateReason(reason: unknown): { reason: string } | { error: string } {
  if (reason === undefined || reason === null || reason === '') return { reason: '' };
  if (typeof reason !== 'string' || reason.length > MAX_REASON_LENGTH) return { error: 'invalid_reason' };
  return { reason: reason.trim() };
}

export function validateAction<T extends string>(allowed: readonly T[], value: unknown): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export function validateExpectedUpdatedAt(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return null;
  // Loose ISO-like / SQLite datetime format guard; the real match is done by the UPDATE.
  if (!/^[\d\-T:.Z+ ]+$/.test(value)) return null;
  return value;
}

/** True when `body` contains any key outside the allowed set (strict schema). */
export function hasUnknownFields(body: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(body).some((key) => !allowed.has(key));
}

/**
 * Atomic audit write: INSERT INTO admin_audit_log inside the caller's
 * transaction/batch. `db` must be a drizzle handle exposing `.insert/.values/.run`.
 */
export async function writeAuditLog(db: unknown, entry: {
  actorUserId: string;
  action: string;
  targetType: AdminTargetType;
  targetId: string;
  beforeJson?: string | null;
  afterJson?: string | null;
  reason?: string;
  result?: 'success' | 'failure';
}): Promise<void> {
  const { adminAuditLog } = await import('@/lib/schema');
  await (db as { insert: (t: unknown) => { values: (v: unknown) => { run: () => Promise<unknown> } } })
    .insert(adminAuditLog)
    .values({
      id: (globalThis.crypto as Crypto)?.randomUUID?.() ?? `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      actorUserId: entry.actorUserId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      beforeJson: entry.beforeJson ?? null,
      afterJson: entry.afterJson ?? null,
      reason: entry.reason ?? '',
      result: entry.result ?? 'success',
    })
    .run();
}

/** Whitelisted, secret-free snapshot of a user row for the audit trail. */
export function userAuditSnapshot(row: { id: string; display_name?: string; is_admin: number; is_blocked: number; blocked_reason?: string; created_at?: string; updated_at?: string }): Record<string, unknown> {
  return {
    id: row.id,
    display_name: row.display_name ?? '',
    is_admin: row.is_admin,
    is_blocked: row.is_blocked,
    blocked_reason: row.blocked_reason ?? '',
    created_at: row.created_at ?? '',
    updated_at: row.updated_at ?? '',
  };
}

/** Whitelisted, secret-free snapshot of a song row for the audit trail (never the full lyrics). */
export function songAuditSnapshot(row: { id: string; title: string; artist?: string; is_public: number; public_requested?: number; updated_at?: string }): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist ?? '',
    is_public: row.is_public,
    public_requested: row.public_requested ?? 0,
    updated_at: row.updated_at ?? '',
  };
}

/** Deterministic ORDER BY / cursor helpers shared by the paged list APIs. */
export function clampLimit(value: unknown, fallback = 25): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_PAGE_LIMIT, Math.max(1, Math.floor(n)));
}

export interface PageResult<T> {
  items: T[];
  next_cursor: string | null;
  total?: number;
}

/**
 * Build a `WHERE` continuation for the stable `(updated_at, id)` cursor.
 * `cursor` is the opaque value returned by a previous page. Returns a SQL
 * fragment and the matching params via drizzle template literal.
 */
export function cursorWhere(
  cursor: string | null,
  sortDir: 'asc' | 'desc',
  idCol: unknown,
  updatedCol: unknown,
): ReturnType<typeof sql> | null {
  if (!cursor) return null;
  const sep = cursor.indexOf(':');
  if (sep <= 0) return null;
  const ts = cursor.slice(0, sep);
  const id = cursor.slice(sep + 1);
  if (!ts || !id) return null;
  return sortDir === 'asc'
    ? sql`((${updatedCol as never} > ${ts}) OR (${updatedCol as never} = ${ts} AND ${idCol as never} > ${id}))`
    : sql`((${updatedCol as never} < ${ts}) OR (${updatedCol as never} = ${ts} AND ${idCol as never} < ${id}))`;
}

/** Encode a page cursor for the `(updated_at, id)` tuple. */
export function makeCursor(updatedAt: string | null | undefined, id: string): string {
  return `${updatedAt ?? ''}:${id}`;
}

/** Look up the latest admin activity for the system view (recent 20). */
export async function listRecentAudit(limit = 20) {
  const { getDB } = await import('@/lib/db');
  const db = getDB();
  return db.all(
    sql`SELECT id, actor_user_id, action, target_type, target_id, reason, result, occurred_at
        FROM admin_audit_log ORDER BY occurred_at DESC, id DESC LIMIT ${limit}`
  );
}
