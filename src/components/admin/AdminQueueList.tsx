'use client';

import { AlertTriangle, ChevronRight, Clock } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { localeToBCP47, type AdminSong } from './admin-types';

interface AdminQueueListProps {
  songs: AdminSong[];
  locale: string;
  selectedId: string | null;
  onSelect: (song: AdminSong) => void;
}

/**
 * Pending public-approval queue (ISSUE #82). Desktop renders as the left-hand
 * column of a list-detail workflow; mobile row opens the full-screen detail
 * sheet. Priority badges surface needs-review / quality flags up front.
 */
export default function AdminQueueList({ songs, locale, selectedId, onSelect }: AdminQueueListProps) {
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

  return (
    <ul className="space-y-2" role="listbox" aria-label={t('admin.viewQueue')}>
      {songs.map((s) => {
        const active = s.id === selectedId;
        return (
          <li key={s.id}>
            <button
              type="button"
              role="option"
              aria-selected={active}
              onClick={() => onSelect(s)}
              className={`w-full rounded-lg border p-4 text-left transition-colors ${
                active
                  ? 'border-[var(--primary)] bg-[var(--primary)]/10'
                  : 'border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)]/40 hover:bg-[var(--accent)]/40'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{s.title}</span>
                {(s.lyrics_needs_review ?? 0) === 1 && (
                  <span className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--destructive)]/10 text-[var(--destructive)]">
                    <AlertTriangle className="h-3 w-3 mr-0.5" />
                    {t('admin.lyricsNeedsReview')}
                  </span>
                )}
                <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
              </div>
              <div className="text-xs text-[var(--muted-foreground)] mt-0.5 truncate">{s.artist}</div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {s.created_by_name && (
                  <span className="text-[10px] text-[var(--muted-foreground)]/60">{s.created_by_name}</span>
                )}
                <span className="text-[10px] text-[var(--muted-foreground)]/60">
                  {new Date(s.created_at).toLocaleDateString(bcp47)}
                </span>
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--muted)] text-[var(--muted-foreground)]">
                  {t('admin.lyricLines', { count: String(lineCount(s)) })}
                </span>
                {s.lyrics_source && (
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--muted)] text-[var(--muted-foreground)]">
                    {s.lyrics_source}
                  </span>
                )}
                {typeof s.lyrics_confidence === 'number' && s.lyrics_confidence < 100 && (
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--warning)]/10 text-[var(--warning)]">
                    {t('admin.confidence', { value: String(s.lyrics_confidence) })}
                  </span>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
