'use client';

import { Check, Clock, Eye, EyeOff, Music, Trash2, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { localeToBCP47, type AdminSong } from './admin-types';

interface AdminSongListProps {
  songs: AdminSong[];
  locale: string;
  onToggleVisibility: (song: AdminSong) => void;
  onApprove: (song: AdminSong) => void;
  onReject: (song: AdminSong) => void;
  onDelete: (song: AdminSong) => void;
}

/** Admin song management: visibility toggle, pending approval actions, delete. */
export default function AdminSongList({ songs, locale, onToggleVisibility, onApprove, onReject, onDelete }: AdminSongListProps) {
  const { t } = useI18n();
  const bcp47 = localeToBCP47(locale);

  if (songs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Music className="h-8 w-8 mb-3 text-[var(--muted-foreground)] opacity-20" />
        <p className="text-sm text-[var(--muted-foreground)]">{t('admin.noSongs')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {songs.map((s) => (
        <div key={s.id} className="rounded-lg bg-[var(--card)] border border-[var(--border)] p-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{s.title}</span>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  s.is_public === 1
                    ? 'bg-[var(--success)]/20 text-[var(--success)]'
                    : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
                }`}>
                  {s.is_public === 1 ? t('admin.public') : t('admin.private')}
                </span>
                {s.public_requested === 1 && s.is_public === 0 && (
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--warning)]/20 text-[var(--warning)]">
                    <Clock className="h-3 w-3 mr-0.5" />
                    {t('admin.pendingApproval')}
                  </span>
                )}
              </div>
              <div className="text-xs text-[var(--muted-foreground)] mt-0.5 truncate">{s.artist}</div>
              {s.created_by_name && (
                <div className="text-[10px] text-[var(--muted-foreground)]/60 mt-0.5">{t('home.createdBy')}: {s.created_by_name}</div>
              )}
              <div className="text-[10px] text-[var(--muted-foreground)]/60 mt-1">
                {new Date(s.created_at).toLocaleDateString(bcp47)}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {s.public_requested === 1 && s.is_public === 0 && (
                <>
                  <button
                    onClick={() => onApprove(s)}
                    className="rounded p-2 text-[var(--success)] hover:bg-[var(--success)]/10 transition-colors"
                    title={t('admin.approve')}
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => onReject(s)}
                    className="rounded p-2 text-[var(--destructive)] hover:bg-[var(--destructive)]/10 transition-colors"
                    title={t('admin.reject')}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </>
              )}
              <button
                onClick={() => onToggleVisibility(s)}
                className={`rounded p-2 transition-colors ${
                  s.is_public === 1
                    ? 'text-[var(--success)] hover:bg-[var(--success)]/10'
                    : 'text-[var(--muted-foreground)] hover:text-[var(--success)] hover:bg-[var(--accent)]'
                }`}
                title={t('admin.toggleVisibility')}
              >
                {s.is_public === 1 ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </button>
              <button
                onClick={() => onDelete(s)}
                className="rounded p-2 text-[var(--destructive)] hover:bg-[var(--destructive)]/10 transition-colors"
                title={t('common.delete')}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
