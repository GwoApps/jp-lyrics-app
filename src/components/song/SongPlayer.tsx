'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Pause, Play } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { fmtTime } from '@/lib/lrc';
import type { SpotifyState } from '@/hooks/useSpotifySync';

interface Props {
  playback: SpotifyState | null;
  playbackMsRef: React.RefObject<number | null>;
  matching: boolean;
  simulated: boolean;
  estimated: boolean;
  loading: boolean;
  unavailable: boolean;
  onToggle: () => Promise<void> | void;
  onSeek: (positionMs: number) => Promise<void> | void;
}

/** Display ticks are local to this small card; the lyric page never renders per frame. */
export default function SongPlayer({ playback, playbackMsRef, matching, simulated, estimated, loading, unavailable, onToggle, onSeek }: Props) {
  const { t } = useI18n();
  const [position, setPosition] = useState(0);
  const [draft, setDraft] = useState<number | null>(null);
  const draftRef = useRef<number | null>(null);
  const [pending, setPending] = useState(false);
  const duration = playback?.duration_ms ?? 0;
  const playing = playback?.is_playing === true;
  const identity = playback?.track?.id || playback?.track?.uri || playback?.track?.name || '';
  useEffect(() => {
    const start = performance.now();
    const update = () => {
      const smooth = matching && playing ? playbackMsRef.current : null;
      setPosition(Math.min(duration, Math.max(0, smooth ?? ((playback?.progress_ms ?? 0) + (playing ? performance.now() - start : 0)))));
    };
    update();
    if (!playing) return;
    const interval = setInterval(update, 200);
    return () => clearInterval(interval);
  }, [playback, playing, duration, matching, playbackMsRef]);
  useEffect(() => {
    // Source changes invalidate an unfinished scrub instead of seeking the next track.
    draftRef.current = null;
    queueMicrotask(() => setDraft(null));
  }, [identity, simulated]);
  const disabled = loading || unavailable || !playback?.track || duration <= 0 || pending;
  const current = Math.min(duration, draft ?? position);
  const run = async (operation: () => Promise<void> | void) => {
    setPending(true);
    try { await operation(); } finally { setPending(false); }
  };
  const commit = () => {
    const value = draftRef.current;
    draftRef.current = null;
    if (value == null) return;
    if (!disabled) void run(() => onSeek(value)).finally(() => setDraft(null));
    else setDraft(null);
  };
  const state = loading ? t('player.loading') : unavailable ? t('player.unavailable')
    : !playback?.track ? t('player.noDevice') : playing ? t('player.playing')
      : current >= duration && duration > 0 ? t('player.ended') : t('player.paused');

  return (
    <section id="song-player" className="song-player" aria-label={t('player.label')} aria-busy={pending} data-source={simulated ? 'simulation' : 'spotify'}>
      <button type="button" className="song-player__toggle" disabled={disabled}
        aria-label={playing ? t('player.pause') : t('player.play')} title={playing ? t('player.pause') : t('player.play')}
        onClick={() => void run(onToggle)}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : playing ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="h-4 w-4" fill="currentColor" />}
      </button>
      <div className="song-player__body">
        <div className="song-player__meta">
          <span className="song-player__title">{simulated ? t('player.simulation') : playback?.track?.name || 'Spotify'}<span className="song-player__state"> · {state}</span></span>
          <span className="song-player__note">{simulated ? t(estimated ? 'player.estimated' : 'player.silent') : t(matching ? 'player.spotify' : 'player.otherTrack')}</span>
        </div>
        <div className="song-player__timeline">
          <span className="song-player__time" data-player-elapsed>{fmtTime(current)}</span>
          <input type="range" min={0} max={Math.max(1, duration)} step={100} value={current} disabled={disabled}
            aria-label={t('player.seek')} aria-valuetext={`${fmtTime(current)} / ${fmtTime(duration)}`}
            style={{ ['--player-progress' as string]: `${duration > 0 ? current / duration * 100 : 0}%` }}
            onChange={(event) => { const value = Number(event.target.value); draftRef.current = value; setDraft(value); }}
            onPointerUp={commit} onKeyUp={commit} onBlur={commit}
            onPointerCancel={() => { draftRef.current = null; setDraft(null); }} />
          <span className="song-player__time">{fmtTime(duration)}</span>
        </div>
      </div>
    </section>
  );
}
