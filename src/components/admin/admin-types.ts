'use client';

/** Shared types and helpers for the admin console. */

export interface AdminUser {
  id: string;
  display_name: string;
  is_admin: number;
  is_blocked: number;
  blocked_reason: string;
  created_at: string;
  updated_at: string;
  /** Aggregated counts returned by the paged users API. */
  song_count?: number;
  public_song_count?: number;
  favorite_count?: number;
  collection_count?: number;
}

export interface AdminSong {
  id: string;
  title: string;
  artist: string;
  created_by: string;
  created_by_name: string;
  is_public: number;
  public_requested: number;
  created_at: string;
  updated_at: string;
  // Lightweight quality summary returned by GET /api/admin/songs.
  lyric_line_count?: number;
  has_synced_timeline?: number | boolean;
  has_furigana?: number | boolean;
  has_translation?: number | boolean;
  lyrics_preview?: string;
  lyrics_needs_review?: number;
  lyrics_confidence?: number;
  lyrics_source?: string;
}

/** Server-side paged list envelope shared by all admin list APIs. */
export interface AdminPage<T> {
  items: T[];
  next_cursor: string | null;
  total?: number;
}

/** Top-level admin views (ISSUE #82 information architecture). */
export type AdminView = 'queue' | 'content' | 'people' | 'system';

/** The legacy internal tab id is gone — the URL drives the view. */
export const ADMIN_VIEWS: AdminView[] = ['queue', 'content', 'people', 'system'];

export const ADMIN_ERROR_KEYS: Record<string, string> = {
  forbidden: 'apiErrors.forbidden',
  cannot_block_self: 'admin.cannotBlockSelf',
  cannot_remove_own_admin: 'admin.cannotDemoteSelf',
  cannot_delete_self: 'admin.cannotDeleteSelf',
  last_admin: 'admin.lastAdmin',
  user_not_found: 'admin.userNotFound',
  song_not_found: 'song.notFound',
  stale_resource: 'admin.staleResource',
  not_pending_approval: 'admin.notPendingApproval',
  invalid_action: 'admin.invalidAction',
  invalid_fields: 'admin.invalidFields',
  invalid_reason: 'admin.invalidReason',
  invalid_json: 'admin.invalidJson',
};

export function adminErrorMessage(t: (key: string) => string, error: unknown, fallbackKey: string): string {
  return typeof error === 'string' && ADMIN_ERROR_KEYS[error]
    ? t(ADMIN_ERROR_KEYS[error])
    : t(fallbackKey);
}

/** Locale → BCP-47 tag for date formatting. */
export function localeToBCP47(locale: string): string {
  const map: Record<string, string> = { ja: 'ja-JP', en: 'en-US', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW' };
  return map[locale] || 'zh-CN';
}

/** Opaque cursor encoder used by the admin list APIs (mirrors the server). */
export function encodeAdminCursor(keys: (string | number)[]): string {
  return btoa(JSON.stringify(keys)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function decodeAdminCursor(cursor: string | null): (string | number)[] | null {
  if (!cursor) return null;
  try {
    const b64 = cursor.replaceAll('-', '+').replaceAll('_', '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const parsed = JSON.parse(atob(padded));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
