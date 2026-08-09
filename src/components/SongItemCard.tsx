'use client';

import { useRef } from 'react';
import { Share2, Star, Trash2 } from 'lucide-react';
import { Link } from 'next-view-transitions';
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
  variant?: 'list' | 'grid';
  hideCover?: boolean;
  isPlaying: boolean | undefined;
  spotifyConnected: boolean;
  isFavorite: boolean;
  locale: string;
  unknownArtistLabel: string;
  createdByLabel: string;
  shareLabel: string;
  openSongLabel: (title: string) => string;
  favoriteLabel: (title: string, isFavorite: boolean) => string;
  deleteLabel: (title: string) => string;
  onPrefetch: () => void;
  onToggleFavorite: () => void;
  onShare: () => void;
  onDelete: () => void;
}

export default function SongItemCard({
  song,
  variant = 'list',
  hideCover = false,
  isPlaying,
  spotifyConnected,
  isFavorite,
  locale,
  unknownArtistLabel,
  createdByLabel,
  shareLabel,
  openSongLabel,
  favoriteLabel: favoriteAccessibleName,
  deleteLabel,
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

  const updatePointer = (event: React.PointerEvent<HTMLElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--song-card-pointer-x', `${event.clientX - rect.left}px`);
    card.style.setProperty('--song-card-pointer-y', `${event.clientY - rect.top}px`);
  };

  const setTouching = (touching: boolean) => {
    const card = cardRef.current;
    if (!card) return;
    if (touching) card.dataset.touching = 'true';
    else delete card.dataset.touching;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    updatePointer(event);
    if (event.pointerType === 'touch') setTouching(true);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') setTouching(false);
  };

  const handlePointerCancel = () => setTouching(false);

  return (
    <div
      ref={cardRef}
      data-song-card-id={song.id}
      className={`song-item-card song-item-card--${variant} group flex items-center gap-3 sm:gap-4 rounded-lg border px-4 sm:px-5 py-3 sm:py-4${isPlaying ? ' song-item-card--playing' : ''}`}
      style={{ ['--song-card-accent' as string]: accent }}
      onPointerEnter={(event) => { updatePointer(event); onPrefetch(); }}
      onPointerMove={updatePointer}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={handlePointerCancel}
    >
      <div className="song-item-card__pointer-glow" aria-hidden="true" />
      <Link
        href={`/songs/${song.id}`}
        aria-label={openSongLabel(song.title)}
        className="song-item-card__main relative z-10 flex flex-1 min-w-0 items-center gap-3 sm:gap-4 rounded outline-none"
        onPointerEnter={(event) => {
          updatePointer(event);
        }}
      >
        {!hideCover && <CoverImage src={song.cover_url} alt={song.title} size={variant === 'grid' ? 'md' : 'sm'} className="song-item-card__cover z-10" viewTransitionName={`song-cover-${song.id}`} />}
        <div className="song-item-card__content relative z-10 flex-1 min-w-0">
          <div className="text-sm font-medium truncate flex items-center gap-2">
            <span className="truncate">{song.title}</span>
            {isPlaying && <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--success)] animate-pulse shrink-0" />}
          </div>
          <div className="text-xs text-[var(--muted-foreground)] mt-0.5 truncate">
            <span className="truncate">{song.artist || unknownArtistLabel}</span>
          </div>
          {song.created_by_name && (
            <div className="text-[10px] text-[var(--muted-foreground)]/60 mt-0.5 truncate">{createdByLabel}: {song.created_by_name}</div>
          )}
        </div>
        <div className="song-item-card__date relative z-10 text-[10px] sm:text-[11px] text-[var(--muted-foreground)] hidden sm:block shrink-0">
          {new Date(song.updated_at).toLocaleDateString(locale)}
        </div>
      </Link>
      <div className="song-item-card__actions relative z-10 flex items-center gap-0.5 shrink-0">
        {spotifyConnected && (
          <>
            <button onClick={onToggleFavorite} aria-label={favoriteAccessibleName(song.title, isFavorite)} aria-pressed={isFavorite} className={`rounded p-1.5 sm:p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${isFavorite ? 'text-[var(--warning)]' : 'text-[var(--muted-foreground)] hover:text-[var(--warning)]'}`}>
              <Star className={`h-3.5 w-3.5 ${isFavorite ? 'fill-current' : ''}`} />
            </button>
            <button onClick={onShare} title={shareLabel} aria-label={shareLabel} className="rounded p-1.5 sm:p-2 text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--accent)]/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
              <Share2 className="h-3.5 w-3.5" />
            </button>
            <button onClick={onDelete} aria-label={deleteLabel(song.title)} className="rounded p-1.5 sm:p-2 text-[var(--destructive)] hover:bg-[var(--destructive)]/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
