'use client';

import { ChevronDown, Loader2, Music, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import { isSpotifyAuthError, isSpotifyTransientError } from '@/lib/spotify-error';
import type { SpotifyState } from '@/hooks/useSpotifySync';
import type { SyncState } from '@/hooks/useNowPlaying';
import SpotifyLoginButton from '@/components/SpotifyLoginButton';

export default function SongPlaybackStatus({ connected, spotify, syncState, matching, simulatedPlaying, expanded, onToggle, onResume, otherTrackAction }: {
  connected: boolean | null; spotify: SpotifyState | null; syncState: SyncState;
  matching: boolean; simulatedPlaying: boolean; expanded: boolean;
  onToggle: () => void; onResume: () => void; otherTrackAction: ReactNode;
}) {
  const { t } = useI18n();
  let label: string;
  let warning = false;
  let loading = false;
  let action: ReactNode = null;
  if (connected === null || (connected && !spotify)) {
    label = t('song.spotifyLoading'); loading = true;
  } else if (!connected) {
    label = simulatedPlaying ? t('player.simulationPlaying') : t('song.spotifyDisconnected');
  } else if (syncState === 'stopped') {
    label = t('song.syncStopped'); warning = true;
    action = <button type="button" className="song-playing-action" onClick={onResume}><RefreshCw className="h-3 w-3" />{t('song.resumeSync')}</button>;
  } else if (syncState === 'retrying') {
    label = t('song.syncRetrying'); warning = true; loading = true;
  } else if (spotify?.error) {
    warning = true;
    if (isSpotifyAuthError(spotify.error)) {
      label = t('song.tokenExpired');
      action = <SpotifyLoginButton className="song-playing-action"><RefreshCw className="h-3 w-3" />{t('song.reconnect')}</SpotifyLoginButton>;
    } else if (isSpotifyTransientError(spotify.error)) {
      label = t('song.spotifyTempUnavailable'); loading = true;
    } else label = t('song.spotifyError', { code: spotify.error });
  } else {
    label = spotify?.track?.name || t('player.noDevice');
    if (spotify?.track && !spotify.is_playing) label += ` · ${t('player.paused')}`;
    if (!matching && spotify?.track) action = otherTrackAction;
  }
  return (
    <div className={`song-playing-surface song-playback-tag${matching || simulatedPlaying ? ' song-playing-surface--synced' : ''}${warning ? ' song-playback-tag--warning' : ''}`}>
      <button type="button" className="song-playback-tag__trigger" onClick={onToggle}
        aria-expanded={expanded} aria-controls="song-player" title={t(expanded ? 'player.collapse' : 'player.expand')}>
        {loading ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : <Music className="h-3 w-3 shrink-0" />}
        <span className="truncate">{label}</span>
        <ChevronDown aria-hidden="true" className={`song-playback-tag__chevron h-3 w-3 shrink-0${expanded ? ' song-playback-tag__chevron--open' : ''}`} />
      </button>
      {action}
    </div>
  );
}
