'use client';

import { useEffect, useState } from 'react';

interface NowPlayingTrack {
  id: string;
  name: string;
  artist: string;
}

interface NowPlayingMetadataProps {
  track: NowPlayingTrack;
}

type Phase = 'idle' | 'out' | 'in';

function trackKey(track: NowPlayingTrack) {
  return `${track.id}\u0000${track.name}\u0000${track.artist}`;
}

/** Fades the prior track out before showing the next track, avoiding text replacement flashes. */
export default function NowPlayingMetadata({ track }: NowPlayingMetadataProps) {
  const [displayedTrack, setDisplayedTrack] = useState(track);
  const [phase, setPhase] = useState<Phase>('idle');
  const incomingKey = trackKey(track);

  useEffect(() => {
    if (trackKey(displayedTrack) === incomingKey) return;

    const fadeTimer = window.setTimeout(() => setPhase('out'), 0);
    const swapTimer = window.setTimeout(() => {
      setDisplayedTrack(track);
      setPhase('in');
    }, 140);
    const settleTimer = window.setTimeout(() => setPhase('idle'), 320);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(swapTimer);
      window.clearTimeout(settleTimer);
    };
  }, [displayedTrack, incomingKey, track]);

  return (
    <div className={`now-playing-metadata now-playing-metadata--${phase}`} aria-live="polite">
      <div className="text-sm font-medium truncate">{displayedTrack.name}</div>
      <div className="text-xs text-[var(--muted-foreground)] truncate">{displayedTrack.artist}</div>
    </div>
  );
}
