'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { importErrorMsg } from '@/lib/import-errors';
import type { SongItem } from '@/lib/types';
import ConfirmDialog from '@/components/ConfirmDialog';
import Toast from '@/components/Toast';

interface PlaylistImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** Fired with the refreshed song list after a successful import. */
  onImported: (songs: SongItem[]) => void;
}

/**
 * Spotify playlist URL importer. Owns its URL/result/error state; the page
 * only receives the refreshed song list on success.
 */
export default function PlaylistImportDialog({ open, onClose, onImported }: PlaylistImportDialogProps) {
  const { t } = useI18n();
  const [url, setUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ total: number; imported: number; skipped: number; failed: number } | null>(null);
  const [alert, setAlert] = useState<{ message: string } | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const handleImport = async () => {
    if (!url.trim() || importing) return;
    setImporting(true);
    setResult(null);
    try {
      const res = await fetch('/api/songs/import-playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlistUrl: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setAlert({ message: importErrorMsg(t, data.error, 'home.playlistImportError') });
        return;
      }
      setResult(data);
      // Refresh song list
      const songsRes = await fetch('/api/songs');
      if (songsRes.ok) {
        const songs = await songsRes.json() as SongItem[];
        onImported(songs);
      }
    } catch {
      setToast({ type: 'error', msg: t('home.playlistImportFailed') });
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      {open && (
        <div className="mb-4 rounded-lg bg-[var(--card)] border border-[var(--border)] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Download className="h-4 w-4 text-[var(--primary)]" />
            <span className="text-sm font-medium">{t('home.playlistImportTitle')}</span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('home.playlistUrlPlaceholder')}
              className="flex-1 rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-xs outline-none focus:border-[var(--primary)] transition-colors placeholder:text-[var(--muted-foreground)]/50"
              disabled={importing}
            />
            <button
              onClick={() => void handleImport()}
              disabled={importing || !url.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-4 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              <span>{importing ? t('home.playlistImporting') : t('home.playlistImportBtn')}</span>
            </button>
          </div>
          {result && (
            <div className="mt-3 text-xs text-[var(--muted-foreground)]">
              {t('home.playlistImportResult', {
                total: String(result.total),
                imported: String(result.imported),
                skipped: String(result.skipped),
                failed: String(result.failed),
              })}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!alert}
        title={t('home.importErrorTitle')}
        body={alert?.message}
        confirmLabel={t('common.confirm')}
        alert
        onConfirm={() => setAlert(null)}
        onCancel={() => setAlert(null)}
      />
      {toast && <Toast type={toast.type} message={toast.msg} />}
    </>
  );
}
