'use client';

import { Ban, ChevronLeft, ChevronRight, Search, Shield, ShieldOff, Trash2, Users, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { localeToBCP47, type AdminUser } from './admin-types';

export type UserRoleFilter = 'all' | 'admin' | 'user';
export type UserStatusFilter = 'all' | 'active' | 'blocked';

interface AdminUserListProps {
  users: AdminUser[];
  total?: number;
  q: string;
  role: UserRoleFilter;
  status: UserStatusFilter;
  hasNext: boolean;
  hasPrev: boolean;
  onQChange: (q: string) => void;
  onRoleChange: (r: UserRoleFilter) => void;
  onStatusChange: (s: UserStatusFilter) => void;
  onNext: () => void;
  onPrev: () => void;
  currentUserId: string;
  locale: string;
  onPromote: (user: AdminUser) => void;
  onDemote: (user: AdminUser) => void;
  onBlock: (user: AdminUser) => void;
  onUnblock: (user: AdminUser) => void;
  onDelete: (user: AdminUser) => void;
}

/**
 * Admin "用户" view (ISSUE #82): server-side searched / filtered / paged user
 * list with aggregated song counts. Role adjustments and deletion are explicit,
 * labeled actions (kept out of the primary action area), self-protected.
 */
export default function AdminUserList({
  users, total, q, role, status, hasNext, hasPrev, onQChange, onRoleChange, onStatusChange,
  onNext, onPrev, currentUserId, locale, onPromote, onDemote, onBlock, onUnblock, onDelete,
}: AdminUserListProps) {
  const { t } = useI18n();
  const bcp47 = localeToBCP47(locale);

  const inputCls = 'rounded-md border border-[var(--border)] bg-[var(--input)] px-2.5 py-1.5 text-xs outline-none focus:border-[var(--primary)] transition-colors';

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
          <input
            type="search"
            value={q}
            onChange={(e) => onQChange(e.target.value)}
            placeholder={t('admin.searchUsers')}
            aria-label={t('admin.searchUsers')}
            className={`${inputCls} w-full pl-8 pr-7`}
          />
          {q && (
            <button
              type="button"
              onClick={() => onQChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              aria-label={t('common.clear')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={role} onChange={(e) => onRoleChange(e.target.value as UserRoleFilter)} className={inputCls} aria-label={t('admin.filterRole')}>
            <option value="all">{t('admin.filterAll')}</option>
            <option value="admin">{t('admin.adminRole')}</option>
            <option value="user">{t('admin.userRole')}</option>
          </select>
          <select value={status} onChange={(e) => onStatusChange(e.target.value as UserStatusFilter)} className={inputCls} aria-label={t('admin.filterUserStatus')}>
            <option value="all">{t('admin.filterAll')}</option>
            <option value="active">{t('admin.active')}</option>
            <option value="blocked">{t('admin.blocked')}</option>
          </select>
        </div>
      </div>

      <div className="text-[11px] text-[var(--muted-foreground)]/70">
        {typeof total === 'number' ? t('admin.resultCount', { count: String(total) }) : t('admin.resultCountUnknown')}
      </div>

      {users.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Users className="h-8 w-8 mb-3 text-[var(--muted-foreground)] opacity-20" />
          <p className="text-sm text-[var(--muted-foreground)]">{t('admin.noUsers')}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {users.map((u) => {
            const isSelf = u.id === currentUserId;
            return (
              <li key={u.id} className="rounded-lg bg-[var(--card)] border border-[var(--border)] p-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium truncate">{u.display_name || u.id}</span>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        u.is_admin === 1
                          ? 'bg-[var(--primary)]/20 text-[var(--primary)]'
                          : 'bg-[var(--accent)] text-[var(--muted-foreground)]'
                      }`}>
                        {u.is_admin === 1 ? t('admin.adminRole') : t('admin.userRole')}
                      </span>
                      {isSelf && (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--accent)] text-[var(--muted-foreground)]">
                          {t('admin.you')}
                        </span>
                      )}
                      {u.is_blocked === 1 && (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--destructive)]/20 text-[var(--destructive)]">
                          {t('admin.blocked')}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--muted-foreground)] mt-0.5 truncate">{u.id}</div>
                    {u.is_blocked === 1 && u.blocked_reason && (
                      <div className="text-[10px] text-[var(--destructive)] mt-0.5">
                        {t('admin.blockReason')}: {u.blocked_reason}
                      </div>
                    )}
                    <div className="text-[10px] text-[var(--muted-foreground)]/60 mt-1">
                      {new Date(u.created_at).toLocaleDateString(bcp47)}
                      {typeof u.song_count === 'number' && (
                        <> · {t('admin.songCount', { count: String(u.song_count) })}
                          {typeof u.public_song_count === 'number' && u.public_song_count > 0 && (
                            <> / {t('admin.publicSongCount', { count: String(u.public_song_count) })}</>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    {u.is_admin === 1 ? (
                      <button
                        type="button"
                        disabled={isSelf}
                        onClick={() => onDemote(u)}
                        className={`inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium transition-colors ${
                          isSelf
                            ? 'text-[var(--muted-foreground)]/40 cursor-not-allowed'
                            : 'text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10'
                        }`}
                        title={isSelf ? t('admin.cannotDemoteSelf') : t('admin.demote')}
                      >
                        <ShieldOff className="h-3.5 w-3.5" />
                        {t('admin.demote')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onPromote(u)}
                        className="inline-flex items-center gap-1 rounded-md border border-[var(--primary)]/30 px-3 py-1.5 text-xs font-medium text-[var(--primary)] hover:bg-[var(--primary)]/10 transition-colors"
                      >
                        <Shield className="h-3.5 w-3.5" />
                        {t('admin.promote')}
                      </button>
                    )}
                    {u.is_blocked === 1 ? (
                      <button
                        type="button"
                        disabled={isSelf}
                        onClick={() => onUnblock(u)}
                        className="inline-flex items-center gap-1 rounded-md border border-[var(--warning)]/30 px-3 py-1.5 text-xs font-medium text-[var(--warning)] hover:bg-[var(--warning)]/10 transition-colors disabled:opacity-40"
                      >
                        <Ban className="h-3.5 w-3.5" />
                        {t('admin.unblock')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isSelf}
                        onClick={() => onBlock(u)}
                        className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--warning)] hover:bg-[var(--warning)]/10 transition-colors disabled:opacity-40"
                      >
                        <Ban className="h-3.5 w-3.5" />
                        {t('admin.block')}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={isSelf}
                      onClick={() => onDelete(u)}
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--destructive)]/30 px-3 py-1.5 text-xs font-medium text-[var(--destructive)] hover:bg-[var(--destructive)]/10 transition-colors disabled:opacity-40"
                      title={isSelf ? t('admin.cannotDeleteSelf') : t('common.delete')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          type="button"
          disabled={!hasPrev}
          onClick={onPrev}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          {t('admin.prevPage')}
        </button>
        <button
          type="button"
          disabled={!hasNext}
          onClick={onNext}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t('admin.nextPage')}
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
