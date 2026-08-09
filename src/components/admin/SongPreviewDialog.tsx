/* eslint-disable react-hooks/set-state-in-effect */

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Check, ExternalLink, Loader2, Music, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { localeToBCP47, type AdminSong } from './admin-types';

interface SongPreviewDialogProps {
  song: AdminSong | null;
  locale: string;
  onClose: () => void;
  onApprove: (song: AdminSong) => void;
  onReject: (song: AdminSong) => void;
}

interface SongDetail {
  id: string;
  title: string;
  artist: string;
  lyrics_raw: string;
  lyrics_furigana: string;
  lyrics_synced: string;
  lyrics_translation: string;
  lyrics_needs_review?: number;
  lyrics_source?: string;
  lyrics_confidence?: number;
  reading_scheme?: string;
}

/**
 * Full song-content preview for admin approval. The admin list only carries a
 * lightweight summary; this dialog fetches the complete lyrics on demand via
 * the public song endpoint and keeps the approve/reject actions at hand.
 */
interface MetaBadgeProps {
  ok: boolean;
  label: string;
}

/** Small status pill shown in the preview quality row. */
function MetaBadge({ ok, label }: MetaBadgeProps) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
      ok ? 'bg-[var(--success)]/20 text-[var(--success)]' : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
    }`}>
      {ok ? <Check className="h-3 w-3 mr-0.5" /> : <X className="h-3 w-3 mr-0.5" />}
      {label}
    </span>
  );
}

export default function SongPreviewDialog({ song, locale, onClose, onApprove, onReject }: SongPreviewDialogProps) {
  const { t } = useI18n();
  const bcp47 = localeToBCP47(locale);
  const [detail, setDetail] = useState<SongDetail | null>(null);
  // The dialog is keyed by song id in the parent, so it remounts per song and
  // starts in the loading state until the on-demand fetch resolves.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    if (!song) return;
    try {
      const res = await fetch(`/api/songs/${encodeURIComponent(song.id)}`);
      if (!res.ok) throw new Error('load_failed');
      setDetail(await res.json());
      setError(null);
    } catch {
      setError(t('admin.previewLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [song, t]);

  useEffect(() => {
    if (!song) return;
    void loadDetail();
  }, [song, loadDetail]);

  useEffect(() => {
    if (!song) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [song, onClose]);

  if (!song) return null;

  const rawLines = detail?.lyrics_raw?.split('\n').map((l) => l.trim()).filter(Boolean) ?? [];
  const previewLines = song.lyrics_preview?.split('\n').filter(Boolean) ?? rawLines.slice(0, 6);

  const hasTimeline = detail?.lyrics_synced
    ? /\[\d{2}:\d{2}(\.\d+)?\]/.test(detail.lyrics_synced)
    : (song.has_synced_timeline ?? false) === true || song.has_synced_timeline === 1;

  const needsReview = detail?.lyrics_needs_review === 1 || song.lyrics_needs_review === 1;
  const lineCount = rawLines.length > 0 ? rawLines.length : (song.lyric_line_count ?? 0);

  const handleOverlayClick = () => onClose();

  return (
    <div className="confirm-overlay" onClick={handleOverlayClick}>
      <div
        className="confirm-dialog"
        style={{ maxWidth: '560px' }}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold truncate">{song.title}</h2>
            {song.artist && <p className="text-xs text-[var(--muted-foreground)] mt-0.5 truncate">{song.artist}</p>}
            {song.created_by_name && (
              <p className="text-[10px] text-[var(--muted-foreground)]/70 mt-0.5">
                {t('home.createdBy')}: {song.created_by_name} · {new Date(song.created_at).toLocaleDateString(bcp47)}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors"
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <MetaBadge ok={lineCount > 0} label={t('admin.previewLyricLines', { count: String(lineCount) })} />
          <MetaBadge ok={hasTimeline} label={t('admin.previewTimeline')} />
          <MetaBadge ok={(song.has_furigana ?? false) === true || song.has_furigana === 1} label={t('admin.previewFurigana')} />
          <MetaBadge ok={(song.has_translation ?? false) === true || song.has_translation === 1} label={t('admin.previewTranslation')} />
          {needsReview && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--destructive)]/10 text-[var(--destructive)]">
              <AlertTriangle className="h-3 w-3 mr-0.5" />
              {t('admin.previewNeedsReview')}
            </span>
          )}
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 p-3 mb-4 max-h-56 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
            </div>
          ) : error ? (
            <p className="text-xs text-[var(--destructive)] text-center py-4">{error}</p>
          ) : previewLines.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center text-[var(--muted-foreground)]">
              <Music className="h-5 w-5 mb-1.5 opacity-40" />
              <p className="text-xs">{t('admin.previewNoLyrics')}</p>
            </div>
          ) : (
            <pre className="text-xs leading-relaxed whitespace-pre-wrap font-sans text-[var(--foreground)]">{previewLines.join('\n')}</pre>
          )}
          {!loading && !error && lineCount > previewLines.length && (
            <p className="text-[10px] text-[var(--muted-foreground)] mt-2">
              {t('admin.previewMoreLines', { count: String(lineCount - previewLines.length) })}
            </p>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <Link
            href={`/songs/${song.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t('admin.previewOpenInNewTab')}
          </Link>
          <div className="flex-1" />
          <button
            onClick={() => onReject(song)}
            className="inline-flex items-center justify-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium bg-[var(--destructive)]/10 text-[var(--destructive)] hover:bg-[var(--destructive)]/20 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
            {t('admin.reject')}
          </button>
          <button
            onClick={() => onApprove(song)}
            className="inline-flex items-center justify-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium bg-[var(--success)]/20 text-[var(--success)] hover:bg-[var(--success)]/30 transition-colors"
          >
            <Check className="h-3.5 w-3.5" />
            {t('admin.approve')}
          </button>
        </div>
      </div>
    </div>
  );
}
