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
}

export type AdminTab = 'users' | 'songs' | 'pending' | 'translation';

export const ADMIN_ERROR_KEYS: Record<string, string> = {
  forbidden: 'apiErrors.forbidden',
  cannot_block_self: 'admin.cannotBlockSelf',
  cannot_remove_own_admin: 'admin.cannotDemoteSelf',
  cannot_delete_self: 'admin.cannotDeleteSelf',
  user_not_found: 'admin.userNotFound',
  song_not_found: 'song.notFound',
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
