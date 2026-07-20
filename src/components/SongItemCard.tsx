'use client';

import { useRef } from 'react';
import { Share2, Star, Trash2 } from 'lucide-react';
import CoverImage from '@/components/CoverImage';
import { useCoverPalette } from '@/hooks/useCoverPalette';

export interface SongItemCardSong {
  id: string;
  title: string;
  artist: string;
  cover_url?: string | null;
  created_by_name: string;
  updated_at: string;
}

interface SongItemCardProps {
  song: SongItemCardSong;
  isPlaying: boolean | undefined;
  spotifyConnected: boolean;
  isFavorite: boolean;
  locale: string;
  unknownArtistLabel: string;
  createdByLabel: string;
  shareLabel: string;
  onOpen: () => void;
  onPrefetch: () => void;
  onToggleFavorite: () => void;
  onShare: () => void;
  onDelete: () => void;
}

export default function SongItemCard({
  song,
  isPlaying,
  spotifyConnected,
  isFavorite,
  locale,
  unknownArtistLabel,
  createdByLabel,
  shareLabel,
  onOpen,
  onPrefetch,
  onToggleFavorite,
  onShare,
  onDelete,
}: SongItemCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const palette = useCoverPalette(song.cover_url);
  const accent = palette
    ? `rgb(${palette.primary.r} ${palette.primary.g} ${palette.primary.b})`
    : 'var(--border)';

  const updatePointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--song-card-pointer-x', `${event.clientX - rect.left}px`);
    card.style.setProperty('--song-card-pointer-y', `${event.clientY - rect.top}px`);
  };

  return (
    <div
      ref={cardRef}
      className={`song-item-card group flex items-center gap-3 sm:gap-4 rounded-lg border px-4 sm:px-5 py-3 sm:py-4 cursor-pointer${isPlaying ? ' song-item-card--playing' : ''}`}
      style={{ ['--song-card-accent' as string]: accent }}
      onClick={onOpen}
      onPointerEnter={(event) => { updatePointer(event); onPrefetch(); }}
      onPointerMove={updatePointer}
    >
      <div className="song-item-card__pointer-glow" aria-hidden="true" />
      <CoverImage src={song.cover_url} alt={song.title} size="sm" className="z-10" viewTransitionName={`song-cover-${song.id}`} />
      <div className="relative z-10 flex-1 min-w-0">
        <div className="text-sm font-medium truncate flex items-center gap-2">
          <span className="cover-transition truncate" style={{ ['--vt-name' as string]: `song-title-${song.id}` }}>{song.title}</span>
          {isPlaying && <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--success)] animate-pulse shrink-0" />}
        </div>
        <div className="text-xs text-[var(--muted-foreground)] mt-0.5 truncate">
          <span className="cover-transition truncate" style={{ ['--vt-name' as string]: `song-artist-${song.id}` }}>{song.artist || unknownArtistLabel}</span>
        </div>
        {song.created_by_name && (
          <div className="text-[10px] text-[var(--muted-foreground)]/60 mt-0.5 truncate">{createdByLabel}: {song.created_by_name}</div>
        )}
      </div>
      <div className="relative z-10 text-[10px] sm:text-[11px] text-[var(--muted-foreground)] hidden sm:block shrink-0">
        {new Date(song.updated_at).toLocaleDateString(locale)}
      </div>
      <div className="relative z-10 flex items-center gap-0.5 shrink-0">
        {spotifyConnected && (
          <>
            <button onClick={(event) => { event.stopPropagation(); onToggleFavorite(); }} className={`rounded p-1.5 sm:p-2 transition-colors ${isFavorite ? 'text-[var(--warning)]' : 'text-[var(--muted-foreground)] hover:text-[var(--warning)]'}`}>
              <Star className={`h-3.5 w-3.5 ${isFavorite ? 'fill-current' : ''}`} />
            </button>
            <button onClick={(event) => { event.stopPropagation(); onShare(); }} title={shareLabel} aria-label={shareLabel} className="rounded p-1.5 sm:p-2 text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--accent)] transition-colors">
              <Share2 className="h-3.5 w-3.5" />
            </button>
            <button onClick={(event) => { event.stopPropagation(); onDelete(); }} className="rounded p-1.5 sm:p-2 text-[var(--destructive)] hover:bg-[var(--destructive)]/10 transition-colors">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
