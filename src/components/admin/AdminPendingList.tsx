'use client';

import { AlertTriangle, Check, Clock, Eye, X } from 'lucide-react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { localeToBCP47, type AdminSong } from './admin-types';

interface AdminPendingListProps {
  songs: AdminSong[];
  locale: string;
  onPreview: (song: AdminSong) => void;
  onApprove: (song: AdminSong) => void;
  onReject: (song: AdminSong) => void;
}

/** Pending public-approval requests with prominent approve/reject actions. */
export default function AdminPendingList({ songs, locale, onPreview, onApprove, onReject }: AdminPendingListProps) {
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

  const lineCount = (s: AdminSong) => s.lyric_line_count ?? 0;
  const hasFlag = (s: AdminSong, key: 'has_synced_timeline' | 'has_furigana' | 'has_translation') =>
    (s[key] ?? false) === true || s[key] === 1;

  return (
    <div className="space-y-2">
      {songs.map((s) => (
        <div key={s.id} className="rounded-lg bg-[var(--card)] border border-[var(--warning)]/30 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Link
                  href={`/songs/${s.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium truncate hover:text-[var(--primary)] transition-colors"
                >
                  {s.title}
                </Link>
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
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--muted)] text-[var(--muted-foreground)]">
                  {t('admin.lyricLines', { count: String(lineCount(s)) })}
                </span>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  hasFlag(s, 'has_synced_timeline') ? 'bg-[var(--success)]/20 text-[var(--success)]' : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
                }`}>
                  {hasFlag(s, 'has_synced_timeline') ? <Check className="h-3 w-3 mr-0.5" /> : <X className="h-3 w-3 mr-0.5" />}
                  {t('admin.lyricsTimeline')}
                </span>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  hasFlag(s, 'has_furigana') ? 'bg-[var(--success)]/20 text-[var(--success)]' : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
                }`}>
                  {hasFlag(s, 'has_furigana') ? <Check className="h-3 w-3 mr-0.5" /> : <X className="h-3 w-3 mr-0.5" />}
                  {t('admin.lyricsFurigana')}
                </span>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  hasFlag(s, 'has_translation') ? 'bg-[var(--success)]/20 text-[var(--success)]' : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
                }`}>
                  {hasFlag(s, 'has_translation') ? <Check className="h-3 w-3 mr-0.5" /> : <X className="h-3 w-3 mr-0.5" />}
                  {t('admin.lyricsTranslation')}
                </span>
                {(s.lyrics_needs_review ?? 0) === 1 && (
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--destructive)]/10 text-[var(--destructive)]">
                    <AlertTriangle className="h-3 w-3 mr-0.5" />
                    {t('admin.lyricsNeedsReview')}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => onPreview(s)}
                className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              >
                <Eye className="h-3.5 w-3.5" />
                {t('admin.preview')}
              </button>
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
