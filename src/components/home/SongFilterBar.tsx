'use client';

import { Disc3, LayoutGrid, List, Search, Star, User, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export type SongViewMode = 'list' | 'grid' | 'album';

interface SongFilterBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  mobileSearchOpen: boolean;
  onToggleMobileSearch: () => void;
  /** Show the favorites / mine filter buttons (logged-in users only). */
  showUserFilters: boolean;
  favoritesOnly: boolean;
  onToggleFavorites: () => void;
  mySongsOnly: boolean;
  onToggleMine: () => void;
  viewMode: SongViewMode;
  onViewModeChange: (mode: SongViewMode) => void;
}

/**
 * Search + filter toolbar for the song list. Renders a compact mobile row
 * (search expands on demand) and a full desktop row with the same controls.
 */
export default function SongFilterBar({
  searchQuery,
  onSearchChange,
  mobileSearchOpen,
  onToggleMobileSearch,
  showUserFilters,
  favoritesOnly,
  onToggleFavorites,
  mySongsOnly,
  onToggleMine,
  viewMode,
  onViewModeChange,
}: SongFilterBarProps) {
  const { t } = useI18n();

  const viewModeGroup = (
    <div className="inline-flex shrink-0 rounded-md border border-[var(--border)] bg-[var(--accent)] p-0.5" role="group" aria-label={t('home.viewMode')}>
      <button type="button" onClick={() => onViewModeChange('list')} className={`rounded p-1.5 transition-colors ${viewMode === 'list' ? 'bg-[var(--card)] text-[var(--foreground)] shadow-sm' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}`} title={t('home.listView')} aria-label={t('home.listView')} aria-pressed={viewMode === 'list'}><List className="h-3.5 w-3.5" /></button>
      <button type="button" onClick={() => onViewModeChange('grid')} className={`rounded p-1.5 transition-colors ${viewMode === 'grid' ? 'bg-[var(--card)] text-[var(--foreground)] shadow-sm' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}`} title={t('home.gridView')} aria-label={t('home.gridView')} aria-pressed={viewMode === 'grid'}><LayoutGrid className="h-3.5 w-3.5" /></button>
      <button type="button" onClick={() => onViewModeChange('album')} className={`rounded p-1.5 transition-colors ${viewMode === 'album' ? 'bg-[var(--card)] text-[var(--foreground)] shadow-sm' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}`} title={t('home.albumView')} aria-label={t('home.albumView')} aria-pressed={viewMode === 'album'}><Disc3 className="h-3.5 w-3.5" /></button>
    </div>
  );

  const userFilters = showUserFilters ? (
    <div className="flex gap-2">
      <button onClick={onToggleFavorites} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors shrink-0 ${favoritesOnly ? 'bg-[var(--warning)]/20 text-[var(--warning)]' : 'bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}`}>
        <Star className={`h-3.5 w-3.5 ${favoritesOnly ? 'fill-current' : ''}`} />
        <span>{t('home.favorites')}</span>
      </button>
      <button onClick={onToggleMine} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors shrink-0 ${mySongsOnly ? 'bg-[var(--primary)] text-[var(--primary-foreground)]' : 'bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}`}>
        <User className="h-3.5 w-3.5" />
        <span>{t('home.mine')}</span>
      </button>
    </div>
  ) : null;

  return (
    <>
      {/* Mobile: compact row, search expands on demand. */}
      <div className="mb-4 sm:hidden">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleMobileSearch}
            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors ${mobileSearchOpen ? 'bg-[var(--primary)] text-[var(--primary-foreground)]' : 'bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}`}
            aria-label={t('home.search')}
            aria-expanded={mobileSearchOpen}
          >
            <Search className="h-3.5 w-3.5" />
          </button>
          {showUserFilters && (
            <div className="flex min-w-0 flex-1 gap-2">
              <button onClick={onToggleFavorites} className={`inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium transition-colors ${favoritesOnly ? 'bg-[var(--warning)]/20 text-[var(--warning)]' : 'bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}`}>
                <Star className={`h-3.5 w-3.5 shrink-0 ${favoritesOnly ? 'fill-current' : ''}`} /><span className="truncate">{t('home.favorites')}</span>
              </button>
              <button onClick={onToggleMine} className={`inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium transition-colors ${mySongsOnly ? 'bg-[var(--primary)] text-[var(--primary-foreground)]' : 'bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}`}>
                <User className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{t('home.mine')}</span>
              </button>
            </div>
          )}
          <div className="ml-auto">{viewModeGroup}</div>
        </div>
        {mobileSearchOpen && (
          <div className="home-search-shell relative mt-2">
            <Search className="home-search-icon absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
            <input type="search" autoFocus value={searchQuery} onChange={(e) => onSearchChange(e.target.value)} placeholder={t('home.search')} className="home-search-field w-full rounded-md border border-[var(--border)] bg-[var(--input)] pl-9 pr-8 py-2 text-xs outline-none placeholder:text-[var(--muted-foreground)]/50" />
            {searchQuery && <button onClick={() => onSearchChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--foreground)]" aria-label={t('common.clear')}><X className="h-3.5 w-3.5" /></button>}
          </div>
        )}
      </div>

      {/* Desktop: full-width search + filters on one row. */}
      <div className="mb-4 hidden sm:flex sm:items-center gap-2">
        <div className="home-search-shell relative flex-1">
          <Search className="home-search-icon absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
          <input type="search" value={searchQuery} onChange={(e) => onSearchChange(e.target.value)} placeholder={t('home.search')} className="home-search-field w-full rounded-md border border-[var(--border)] bg-[var(--input)] pl-9 pr-8 py-2 text-xs outline-none placeholder:text-[var(--muted-foreground)]/50" />
          {searchQuery && <button onClick={() => onSearchChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--foreground)]" aria-label={t('common.clear')}><X className="h-3.5 w-3.5" /></button>}
        </div>
        {userFilters}
        {viewModeGroup}
      </div>
    </>
  );
}
