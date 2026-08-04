'use client';

import { Ban, Shield, ShieldOff, Trash2, Users } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { localeToBCP47, type AdminUser } from './admin-types';

interface AdminUserListProps {
  users: AdminUser[];
  currentUserId: string;
  locale: string;
  onToggleAdmin: (user: AdminUser) => void;
  onBlock: (user: AdminUser) => void;
  onDelete: (user: AdminUser) => void;
}

/** Admin user management: promote/demote, block/unblock, delete (self-protected). */
export default function AdminUserList({ users, currentUserId, locale, onToggleAdmin, onBlock, onDelete }: AdminUserListProps) {
  const { t } = useI18n();
  const bcp47 = localeToBCP47(locale);

  if (users.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Users className="h-8 w-8 mb-3 text-[var(--muted-foreground)] opacity-20" />
        <p className="text-sm text-[var(--muted-foreground)]">{t('admin.noUsers')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {users.map((u) => {
        const isSelf = u.id === currentUserId;
        return (
          <div key={u.id} className="rounded-lg bg-[var(--card)] border border-[var(--border)] p-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
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
                  <div className="text-[10px] text-[var(--destructive)] mt-0.5">{t('admin.blockReason')}: {u.blocked_reason}</div>
                )}
                <div className="text-[10px] text-[var(--muted-foreground)]/60 mt-1">
                  {new Date(u.created_at).toLocaleDateString(bcp47)}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => onToggleAdmin(u)}
                  disabled={isSelf}
                  className={`rounded p-2 transition-colors ${
                    isSelf
                      ? 'text-[var(--muted-foreground)]/30 cursor-not-allowed'
                      : u.is_admin === 1
                        ? 'text-[var(--primary)] hover:bg-[var(--primary)]/10'
                        : 'text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:bg-[var(--accent)]'
                  }`}
                  title={isSelf ? t('admin.cannotDemoteSelf') : u.is_admin === 1 ? t('admin.demote') : t('admin.promote')}
                >
                  {u.is_admin === 1 ? <ShieldOff className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => onBlock(u)}
                  disabled={isSelf}
                  className={`rounded p-2 transition-colors ${
                    isSelf
                      ? 'text-[var(--muted-foreground)]/30 cursor-not-allowed'
                      : u.is_blocked === 1
                        ? 'text-[var(--warning)] hover:bg-[var(--warning)]/10'
                        : 'text-[var(--muted-foreground)] hover:text-[var(--warning)] hover:bg-[var(--accent)]'
                  }`}
                  title={isSelf ? t('admin.cannotBlockSelf') : u.is_blocked === 1 ? t('admin.unblock') : t('admin.block')}
                >
                  <Ban className="h-4 w-4" />
                </button>
                <button
                  onClick={() => !isSelf && onDelete(u)}
                  disabled={isSelf}
                  className={`rounded p-2 transition-colors ${
                    isSelf
                      ? 'text-[var(--muted-foreground)]/30 cursor-not-allowed'
                      : 'text-[var(--destructive)] hover:bg-[var(--destructive)]/10'
                  }`}
                  title={isSelf ? t('admin.cannotDeleteSelf') : t('common.delete')}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
