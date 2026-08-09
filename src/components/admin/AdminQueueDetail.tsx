/* eslint-disable react-hooks/set-state-in-effect */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, Check, CheckCircle2, ExternalLink, Loader2, Music, RotateCcw, X,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { localeToBCP47, type AdminSong } from './admin-types';

export interface QueueDetail {
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
  created_by?: string;
  created_by_name?: string;
  created_at?: string;
  is_public?: number;
  public_requested?: number;
}

interface AdminQueueDetailProps {
  song: AdminSong;
  locale: string;
  /** Called after a successful approve/reject so the parent advances the queue. */
  onDone: (song: AdminSong, opts?: { keep?: boolean }) => void;
  onApprove: (song: AdminSong) => Promise<boolean>;
  onReject: (song: AdminSong) => Promise<boolean>;
  /** Short-time undo of a just-completed approval. */
  onUndoApprove: (song: AdminSong) => Promise<boolean>;
}

interface MetaBadgeProps {
  ok: boolean;
  label: string;
}

/** Small status pill shown in the quality row. */
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

/**
 * Full lyrics + risk review panel for the pending-approval queue (ISSUE #82).
 * Loads the complete raw lyrics on demand (the list never carries full text),
 * shows the full original content — not just the first 6 lines — plus source,
 * confidence and review flags, and hosts the approve/reject actions.
 *
 * Approve is immediate with a short undo window; reject requires an explicit
 * confirmation. A busy state disables both actions while a request is in
 * flight, failures keep the item on screen with a retry-able message, and a
 * successful action advances the queue via onDone.
 */
export default function AdminQueueDetail({ song, locale, onDone, onApprove, onReject, onUndoApprove }: AdminQueueDetailProps) {
  const { t } = useI18n();
  const bcp47 = localeToBCP47(locale);
  const [detail, setDetail] = useState<QueueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const [justApproved, setJustApproved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadDetail = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    setDetail(null);
    try {
      const res = await fetch(`/api/songs/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error('load_failed');
      const data = (await res.json()) as QueueDetail;
      setDetail(data);
    } catch {
      setError(t('admin.previewLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadDetail(song.id);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [song.id, loadDetail]);

  // Approve: immediate execution + short undo window.
  const handleApprove = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    const ok = await onApprove(song);
    setBusy(false);
    if (!ok) return; // error surfaced by the parent toast
    setJustApproved(true);
    timerRef.current = setTimeout(() => onDone(song), 3000);
  }, [busy, onApprove, onDone, song]);

  const cancelAutoAdvance = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setJustApproved(false);
  }, []);

  // Undo a just-completed approval: returns the song to the pending queue and
  // keeps it on screen (no auto-advance).
  const handleUndoApprove = useCallback(async () => {
    if (busy) return;
    cancelAutoAdvance();
    setBusy(true);
    const ok = await onUndoApprove(song);
    setBusy(false);
    if (ok) onDone(song, { keep: true });
  }, [busy, cancelAutoAdvance, onUndoApprove, onDone, song]);

  // Reject: explicit confirmation, then execute.
  const handleReject = useCallback(async () => {
    if (busy) return;
    if (!confirmReject) {
      setConfirmReject(true);
      return;
    }
    setBusy(true);
    const ok = await onReject(song);
    setBusy(false);
    if (!ok) return;
    onDone(song);
  }, [busy, confirmReject, setConfirmReject, onReject, onDone, song]);

  const rawLines = detail?.lyrics_raw?.split('\n').map((l) => l.trim()).filter(Boolean) ?? [];
  const hasTimeline = detail?.lyrics_synced
    ? /\[\d{2}:\d{2}(\.\d+)?\]/.test(detail.lyrics_synced)
    : (song.has_synced_timeline ?? false) === true || song.has_synced_timeline === 1;
  const needsReview = detail?.lyrics_needs_review === 1 || song.lyrics_needs_review === 1;
  const lineCount = rawLines.length > 0 ? rawLines.length : (song.lyric_line_count ?? 0);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
      {/* Header */}
      <div className="p-4 sm:p-5 border-b border-[var(--border)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold truncate">{song.title}</h2>
            {song.artist && <p className="text-xs text-[var(--muted-foreground)] mt-0.5 truncate">{song.artist}</p>}
            {(detail?.created_by_name || song.created_by_name) && (
              <p className="text-[10px] text-[var(--muted-foreground)]/70 mt-0.5">
                {t('home.createdBy')}: {detail?.created_by_name || song.created_by_name}
                {detail?.created_at && ` · ${new Date(detail.created_at).toLocaleDateString(bcp47)}`}
              </p>
            )}
          </div>
          <Link
            href={`/songs/${song.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('admin.previewOpenInNewTab')}</span>
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mt-3">
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
          {detail?.lyrics_source && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--muted)] text-[var(--muted-foreground)]">
              {t('admin.source')}: {detail.lyrics_source}
            </span>
          )}
          {typeof detail?.lyrics_confidence === 'number' && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--muted)] text-[var(--muted-foreground)]">
              {t('admin.confidence', { value: String(detail.lyrics_confidence) })}
            </span>
          )}
        </div>
      </div>

      {/* Full lyrics */}
      <div className="p-4 sm:p-5">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 p-3 max-h-72 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
            </div>
          ) : error ? (
            <p className="text-xs text-[var(--destructive)] text-center py-4">{error}</p>
          ) : rawLines.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center text-[var(--muted-foreground)]">
              <Music className="h-5 w-5 mb-1.5 opacity-40" />
              <p className="text-xs">{t('admin.previewNoLyrics')}</p>
            </div>
          ) : (
            <pre className="text-xs leading-relaxed whitespace-pre-wrap font-sans text-[var(--foreground)]">{rawLines.join('\n')}</pre>
          )}
        </div>

        {/* Success banner with undo */}
        {justApproved && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm text-[var(--success)]">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1">{t('admin.approvedAdvance')}</span>
            <button
              type="button"
              onClick={() => void handleUndoApprove()}
              disabled={busy}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" />
              {t('admin.undo')}
            </button>
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="border-t border-[var(--border)] p-4 sm:px-5 sticky bottom-0 bg-[var(--card)] rounded-b-lg">
        <div className="flex items-center gap-2">
          {confirmReject && (
            <>
              <span className="text-xs text-[var(--muted-foreground)] mr-auto">{t('admin.confirmRejectQueue')}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmReject(false)}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
            </>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={handleReject}
            className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
              confirmReject
                ? 'bg-[var(--destructive)] text-[var(--destructive-foreground)] hover:opacity-90'
                : 'bg-[var(--destructive)]/10 text-[var(--destructive)] hover:bg-[var(--destructive)]/20'
            }`}
          >
            <X className="h-3.5 w-3.5" />
            {confirmReject ? t('admin.confirmRejectShort') : t('admin.reject')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleApprove}
            className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium bg-[var(--success)]/20 text-[var(--success)] hover:bg-[var(--success)]/30 transition-colors disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {busy ? t('admin.processing') : t('admin.approve')}
          </button>
        </div>
      </div>
    </div>
  );
}
