'use client';

import { Check, Clock, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { localeToBCP47, type AdminSong } from './admin-types';

interface AdminPendingListProps {
  songs: AdminSong[];
  locale: string;
  onApprove: (song: AdminSong) => void;
  onReject: (song: AdminSong) => void;
}

/** Pending public-approval requests with prominent approve/reject actions. */
export default function AdminPendingList({ songs, locale, onApprove, onReject }: AdminPendingListProps) {
  const { t } = useI18n();
  const bcp47 = localeToBCP47(locale);

  if (songs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Clock className="h-8 w-8 mb-3 text-[var(--muted-foreground)] opacity-20" />
        <p className="text-sm text-[var(--muted-foreground)]">{t('admin.noPending')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {songs.map((s) => (
        <div key={s.id} className="rounded-lg bg-[var(--card)] border border-[var(--warning)]/30 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{s.title}</span>
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--warning)]/20 text-[var(--warning)]">
                  <Clock className="h-3 w-3 mr-0.5" />
                  {t('admin.pendingApproval')}
                </span>
              </div>
              <div className="text-xs text-[var(--muted-foreground)] mt-0.5 truncate">{s.artist}</div>
              {s.created_by_name && (
                <div className="text-[10px] text-[var(--muted-foreground)]/60 mt-0.5">{t('home.createdBy')}: {s.created_by_name}</div>
              )}
              <div className="text-[10px] text-[var(--muted-foreground)]/60 mt-1">
                {new Date(s.created_at).toLocaleDateString(bcp47)}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => onApprove(s)}
                className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium bg-[var(--success)]/20 text-[var(--success)] hover:bg-[var(--success)]/30 transition-colors"
              >
                <Check className="h-3.5 w-3.5" />
                {t('admin.approve')}
              </button>
              <button
                onClick={() => onReject(s)}
                className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium bg-[var(--destructive)]/10 text-[var(--destructive)] hover:bg-[var(--destructive)]/20 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
                {t('admin.reject')}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
