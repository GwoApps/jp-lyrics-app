'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { Languages, X } from 'lucide-react';
import Dialog from '@/components/ui/dialog';
import ConfirmDialog from '@/components/ConfirmDialog';
import FuriganaEditor from '@/components/FuriganaEditor';
import { useI18n } from '@/lib/i18n';
import { normalizeReadingScheme } from '@/lib/lyrics-reading';
import { normalizeJapaneseFuriganaLines } from '@/lib/japanese-kanji-reading';
import { furiganaLinesMatchSource } from '@/lib/furigana-validation';
import type { FuriganaLine, SongData } from '@/lib/types';

interface FuriganaLineDialogProps {
  open: boolean;
  songId: string;
  song: SongData;
  /** Source-line index the user right-clicked on the detail page. */
  lineIndex: number;
  onClose: () => void;
  /** Navigate to the existing full correction page, focused on this line. */
  onOpenWholeSong: () => void;
  /** Called after a successful save so the caller can refresh the song + toast. */
  onSaved: () => void;
}

/**
 * Low-intrusion single-line reading correction. It reuses the full editor's
 * line interaction (`FuriganaEditor` with a one-index `visibleLines` subset) so
 * tile editing, dictionary candidates, split/merge and apply scopes behave
 * identically, while the whole-song workflow stays one click away.
 *
 * Mount it with a `key` per opened line so each opening starts from a fresh
 * draft of the song's saved annotations.
 */
export default function FuriganaLineDialog({
  open,
  songId,
  song,
  lineIndex,
  onClose,
  onOpenWholeSong,
  onSaved,
}: FuriganaLineDialogProps) {
  const { t } = useI18n();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const readingScheme = normalizeReadingScheme(song.reading_scheme);
  const sourceLyrics = song.lyrics_raw ?? '';
  const rawLines = useMemo(() => (sourceLyrics ? sourceLyrics.split('\n') : []), [sourceLyrics]);

  // The saved annotations are only editable line-by-line when they still match the
  // current lyrics; a stale payload cannot be safely patched, so that case is handed
  // to the full page, which rebuilds the annotations first.
  const baseLines = useMemo<FuriganaLine[] | null>(() => {
    if (!song.lyrics_furigana) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(song.lyrics_furigana);
    } catch {
      return null;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    if (!furiganaLinesMatchSource(parsed as FuriganaLine[], sourceLyrics)) return null;
    const lines = parsed as FuriganaLine[];
    return readingScheme === 'ja-kana' ? normalizeJapaneseFuriganaLines(lines) : lines;
  }, [readingScheme, song.lyrics_furigana, sourceLyrics]);

  const [draft, setDraft] = useState<FuriganaLine[]>(baseLines ?? []);
  const [original, setOriginal] = useState<FuriganaLine[]>(baseLines ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const isDirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(original), [draft, original]);
  const canEditLine = baseLines !== null && lineIndex >= 0 && lineIndex < (baseLines?.length ?? 0);

  const requestClose = () => {
    if (saving) return;
    if (isDirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  };

  const handleSave = async () => {
    if (!canEditLine || saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/songs/${songId}/furigana`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lyrics_furigana: draft,
          reading_scheme: readingScheme,
          source_lyrics: sourceLyrics,
        }),
      });
      if (!res.ok) {
        if (res.status === 401) throw new Error(t('furigana.loginRequired'));
        if (res.status === 403) throw new Error(t('furigana.forbidden'));
        if (res.status === 409) throw new Error(t('furigana.staleSource'));
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error === 'song_not_found' ? t('song.notFound') : t('furigana.saveFailed'));
      }
      setOriginal(draft);
      onSaved();
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : t('furigana.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={requestClose}
        title={t('furigana.lineDialogTitle', { n: String(lineIndex + 1) })}
        initialFocusRef={closeRef}
        className="max-w-2xl overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] p-0 shadow-2xl"
      >
        <header className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-5">
          <span className="song-accent-surface inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
            <Languages className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-sm font-semibold">
              {t('furigana.lineDialogTitle', { n: String(lineIndex + 1) })}
            </h2>
            <p className="truncate text-xs text-[var(--muted-foreground)]">{t('furigana.lineDialogSubtitle')}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={requestClose}
            aria-label={t('common.close')}
            className="rounded-md p-2 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="max-h-[min(60vh,32rem)] overflow-y-auto px-4 py-4 sm:px-5" data-furigana-line-dialog-body>
          {canEditLine ? (
            <FuriganaEditor
              lines={draft}
              rawLines={rawLines}
              onChange={setDraft}
              readingScheme={readingScheme}
              focusLine={lineIndex}
              visibleLines={[lineIndex]}
              embedded
            />
          ) : (
            <p className="text-sm text-[var(--muted-foreground)]">{t('furigana.lineDialogStale')}</p>
          )}
        </div>

        {error && (
          <p className="px-4 pb-2 text-xs text-[var(--destructive)] sm:px-5" role="alert">{error}</p>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={onOpenWholeSong}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            <Languages className="h-3.5 w-3.5" />
            {t('furigana.correctWholeSong')}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={requestClose}
              disabled={saving}
              className="rounded-md px-4 py-2 text-sm text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!canEditLine || saving || !isDirty}
              className="song-editor-primary-button inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
              {saving ? t('common.loading') : t('common.save')}
            </button>
          </div>
        </footer>
      </Dialog>

      <ConfirmDialog
        open={confirmDiscard}
        title={t('common.unsavedTitle')}
        body={t('common.unsavedBody')}
        confirmLabel={t('common.discard')}
        cancelLabel={t('common.cancel')}
        variant="danger"
        onConfirm={() => { setConfirmDiscard(false); onClose(); }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </>
  );
}
