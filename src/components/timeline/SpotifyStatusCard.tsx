'use client';

import { AlertTriangle, Headphones, Loader2, RefreshCw } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { fmtMs, fmtTime } from '@/lib/lrc';
import type { NowPlayingData, SyncState } from '@/hooks/useNowPlaying';

interface SpotifyStatusCardProps {
  nowPlaying: NowPlayingData | null;
  liveProgress: number;
  canUseSpotifyTime: boolean;
  spotifyMatches: boolean;
  syncState?: SyncState;
  onResume?: () => void;
}

/** Current Spotify playback card with a live progress bar. */
export default function SpotifyStatusCard({ nowPlaying, liveProgress, canUseSpotifyTime, spotifyMatches, syncState = 'connected', onResume }: SpotifyStatusCardProps) {
  const { t } = useI18n();
  const durationMs = nowPlaying?.duration_ms || 0;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${canUseSpotifyTime ? 'bg-[var(--success)]/15 text-[var(--success)]' : 'bg-[var(--muted)] text-[var(--muted-foreground)]'}`}>
            <Headphones className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{nowPlaying?.track?.name || t('timelineWorkspace.spotifyIdle')}</div>
            <div className="truncate text-xs text-[var(--muted-foreground)]">{nowPlaying?.track?.artist || t('timelineWorkspace.spotifyHint')}</div>
          </div>
        </div>
        <div className="font-mono text-xl font-semibold tabular-nums">{fmtMs(liveProgress)}</div>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--muted)]">
        <div className="h-full rounded-full bg-[var(--song-accent)] transition-[width] duration-200" style={{ width: `${durationMs ? Math.min(100, liveProgress / durationMs * 100) : 0}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-[var(--muted-foreground)] tabular-nums">
        <span>{fmtTime(liveProgress)}</span><span>{fmtTime(durationMs)}</span>
      </div>
      {nowPlaying?.track && !spotifyMatches && (
        <div className="mt-3 flex items-start gap-2 rounded-md bg-[var(--warning)]/10 px-3 py-2 text-xs text-[var(--warning)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t('timelineWorkspace.trackMismatch')}
        </div>
      )}
      {syncState === 'stopped' && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-md bg-[var(--warning)]/15 px-3 py-2 text-xs text-[var(--warning)]">
          <span className="flex min-w-0 items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="truncate">{t('song.syncStopped')}</span>
          </span>
          <button onClick={onResume} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--warning)]/20 px-2 py-1 text-[10px] font-medium text-[var(--warning)] transition-colors hover:bg-[var(--warning)]/30">
            <RefreshCw className="h-3 w-3" /><span>{t('song.resumeSync')}</span>
          </button>
        </div>
      )}
      {syncState === 'retrying' && (
        <div className="mt-3 flex items-center gap-2 rounded-md bg-[var(--warning)]/10 px-3 py-2 text-xs text-[var(--warning)]">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          <span className="truncate">{t('song.syncRetrying')}</span>
        </div>
      )}
    </div>
  );
}
