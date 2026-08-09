'use client';

import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Eye, ListMusic, Search, Trash2, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { localeToBCP47, type AdminSong } from './admin-types';

export type SongStatusFilter = 'all' | 'public' | 'private';
export type SongReviewFilter = 'all' | 'needs';
export type SongSort = 'updated' | 'created' | 'confidence';
export type SongOrder = 'desc' | 'asc';

interface AdminSongListProps {
  songs: AdminSong[];
  total?: number;
  q: string;
  status: SongStatusFilter;
  review: SongReviewFilter;
  sort: SongSort;
  order: SongOrder;
  hasNext: boolean;
  hasPrev: boolean;
  onQChange: (q: string) => void;
  onStatusChange: (s: SongStatusFilter) => void;
  onReviewChange: (r: SongReviewFilter) => void;
  onSortChange: (s: SongSort) => void;
  onOrderChange: (o: SongOrder) => void;
  onNext: () => void;
  onPrev: () => void;
  onPreview: (song: AdminSong) => void;
  onPublish: (song: AdminSong) => void;
  onUnpublish: (song: AdminSong) => void;
  onDelete: (song: AdminSong) => void;
  locale: string;
}

/**
 * Admin "内容" view (ISSUE #82): server-side searched / filtered / sorted /
 * paged song library. The primary action is viewing details; publish/unpublish
 * use explicit labeled actions (no silent eye-icon toggles). Pending-approval
 * items only show a status badge that links back to the 待办 queue — there is
 * no approve/reject duplicate entry here.
 */
export default function AdminSongList({
  songs, total, q, status, review, sort, order, hasNext, hasPrev, onQChange, onStatusChange,
  onReviewChange, onSortChange, onOrderChange, onNext, onPrev, onPreview,
  onPublish, onUnpublish, onDelete, locale,
}: AdminSongListProps) {
  const { t } = useI18n();
  const bcp47 = localeToBCP47(locale);

  const inputCls = 'rounded-md border border-[var(--border)] bg-[var(--input)] px-2.5 py-1.5 text-xs outline-none focus:border-[var(--primary)] transition-colors';

  const pendingItems = songs.filter((s) => s.public_requested === 1 && s.is_public === 0);

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
            placeholder={t('admin.searchSongs')}
            aria-label={t('admin.searchSongs')}
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
          <select value={status} onChange={(e) => onStatusChange(e.target.value as SongStatusFilter)} className={inputCls} aria-label={t('admin.filterStatus')}>
            <option value="all">{t('admin.filterAll')}</option>
            <option value="public">{t('admin.public')}</option>
            <option value="private">{t('admin.private')}</option>
          </select>
          <select value={review} onChange={(e) => onReviewChange(e.target.value as SongReviewFilter)} className={inputCls} aria-label={t('admin.filterReview')}>
            <option value="all">{t('admin.filterReviewAll')}</option>
            <option value="needs">{t('admin.lyricsNeedsReview')}</option>
          </select>
          <select value={sort} onChange={(e) => onSortChange(e.target.value as SongSort)} className={inputCls} aria-label={t('admin.sortBy')}>
            <option value="updated">{t('admin.sortUpdated')}</option>
            <option value="created">{t('admin.sortCreated')}</option>
            <option value="confidence">{t('admin.sortConfidence')}</option>
          </select>
          <button
            type="button"
            onClick={() => onOrderChange(order === 'desc' ? 'asc' : 'desc')}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--accent)] px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            aria-label={order === 'desc' ? t('admin.sortAsc') : t('admin.sortDesc')}
          >
            {order === 'desc' ? t('admin.sortDesc') : t('admin.sortAsc')}
            <ChevronDown className={`h-3 w-3 transition-transform ${order === 'asc' ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* Result meta */}
      <div className="text-[11px] text-[var(--muted-foreground)]/70">
        {typeof total === 'number' ? t('admin.resultCount', { count: String(total) }) : t('admin.resultCountUnknown')}
      </div>

      {/* List */}
      {songs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <ListMusic className="h-8 w-8 mb-3 text-[var(--muted-foreground)] opacity-20" />
          <p className="text-sm text-[var(--muted-foreground)]">{t('admin.noSongs')}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {songs.map((s) => (
            <li key={s.id} className="rounded-lg bg-[var(--card)] border border-[var(--border)] p-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
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
                        {t('admin.pendingApproval')}
                      </span>
                    )}
                    {(s.lyrics_needs_review ?? 0) === 1 && (
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--destructive)]/10 text-[var(--destructive)]">
                        <AlertTriangle className="h-3 w-3 mr-0.5" />
                        {t('admin.lyricsNeedsReview')}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--muted-foreground)] mt-0.5 truncate">{s.artist}</div>
                  {s.created_by_name && (
                    <div className="text-[10px] text-[var(--muted-foreground)]/60 mt-0.5">
                      {t('home.createdBy')}: {s.created_by_name}
                    </div>
                  )}
                  <div className="text-[10px] text-[var(--muted-foreground)]/60 mt-1">
                    {t('admin.updatedAt', { date: new Date(s.updated_at).toLocaleDateString(bcp47) })}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onPreview(s)}
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    {t('admin.preview')}
                  </button>
                  {s.public_requested === 1 && s.is_public === 0 ? (
                    // Pending items keep the visibility toggle hidden — the
                    // only path to change their state is the 待办 queue (ISSUE #82).
                    <span className="inline-flex items-center rounded-md border border-[var(--warning)]/30 px-3 py-1.5 text-xs font-medium text-[var(--warning)]">
                      {t('admin.pendingApproval')}
                    </span>
                  ) : s.is_public === 1 ? (
                    <button
                      type="button"
                      onClick={() => onUnpublish(s)}
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                    >
                      {t('admin.unpublish')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onPublish(s)}
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--success)]/30 px-3 py-1.5 text-xs font-medium text-[var(--success)] hover:bg-[var(--success)]/10 transition-colors"
                    >
                      {t('admin.publish')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onDelete(s)}
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--destructive)]/30 px-3 py-1.5 text-xs font-medium text-[var(--destructive)] hover:bg-[var(--destructive)]/10 transition-colors"
                    aria-label={t('common.delete')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Pending hint */}
      {pendingItems.length > 0 && (
        <p className="text-[11px] text-[var(--muted-foreground)]/70">
          {t('admin.pendingInQueue', { count: String(pendingItems.length) })}
        </p>
      )}

      {/* Pager */}
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
