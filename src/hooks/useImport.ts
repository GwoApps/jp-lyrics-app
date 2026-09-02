'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SpotifyState } from './useSpotifySync';
import { buildManualCreateUrl } from '@/lib/song-prefill';
import type { ImportAlertState, ImportReviewState } from './models';

interface UseImportDeps {
  showToast: (type: 'success' | 'error' | 'info', msg: string, actionLabel?: string, onAction?: () => void) => void;
  t: (key: string, params?: Record<string, string>) => string;
}

interface UseImportReturn {
  importing: boolean;
  importAlert: ImportAlertState | null;
  setImportAlert: React.Dispatch<React.SetStateAction<ImportAlertState | null>>;
  importReview: ImportReviewState | null;
  setImportReview: React.Dispatch<React.SetStateAction<ImportReviewState | null>>;
  confirmImportReview: () => Promise<void>;
  handleImportPlaying: (spotify: SpotifyState | null) => Promise<void>;
}

/**
 * Sub-hook: import-from-Spotify workflow (now-playing import + low-confidence
 * review confirmation). Owns `importing`, `importAlert`, and `importReview`
 * state; navigates to the newly-created song on success.
 */
export function useImport(deps: UseImportDeps): UseImportReturn {
  const { showToast, t } = deps;
  const router = useRouter();

  const [importing, setImporting] = useState(false);
  const [importAlert, setImportAlert] = useState<ImportAlertState | null>(null);
  const [importReview, setImportReview] = useState<ImportReviewState | null>(null);

  const handleImportPlaying = useCallback(async (spotify: SpotifyState | null) => {
    if (!spotify?.track) return;
    setImporting(true);
    try {
      const res = await fetch('/api/songs/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: spotify.track.name, artist: spotify.track.artist, spotify_track_id: spotify.track.id }),
      });
      const data = await res.json();
      if (data.needsReview) {
        // Low-confidence candidate — show the summary and ask before saving.
        setImportReview({
          title: spotify.track.name,
          artist: spotify.track.artist,
          spotifyTrackId: spotify.track.id,
          source: data.source,
          confidence: data.confidence,
          lines: data.lines,
          preview: data.preview,
          synced: data.synced,
          match: data.match,
        });
        return;
      }
      if (!res.ok || data.error) {
        const errorKey: Record<string, string> = {
          title_required: 'home.importTitleRequired',
          lyrics_not_found: 'home.importLyricsNotFound',
          lyrics_rate_limited: 'apiErrors.lyricsRateLimited',
          login_required: 'home.importLoginRequired',
        };
        setImportAlert({
          message: data.error && errorKey[data.error]
            ? t(errorKey[data.error])
            : t('song.importFailed'),
          manualCreateUrl: buildManualCreateUrl(data),
        });
        return;
      }
      router.push(`/songs/${data.id}`);
    } catch (error) {
      console.error('导入当前播放歌曲失败', error);
      showToast('error', t('song.importFailed'));
    } finally {
      setImporting(false);
    }
  }, [router, t, showToast]);

  /** Re-run the import with `confirm_review` after the user accepted the candidate. */
  const confirmImportReview = useCallback(async () => {
    if (!importReview) return;
    setImporting(true);
    try {
      const res = await fetch('/api/songs/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: importReview.title, artist: importReview.artist, spotify_track_id: importReview.spotifyTrackId ?? '', confirm_review: true }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setImportAlert({
          message: t('song.importFailed'),
          manualCreateUrl: buildManualCreateUrl(data),
        });
        return;
      }
      router.push(`/songs/${data.id}`);
    } catch {
      showToast('error', t('song.importFailed'));
    } finally {
      setImporting(false);
      setImportReview(null);
    }
  }, [importReview, router, t, showToast]);

  return {
    importing,
    importAlert,
    setImportAlert,
    importReview,
    setImportReview,
    confirmImportReview,
    handleImportPlaying,
  };
}
