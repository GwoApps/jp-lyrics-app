'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransitionRouter } from 'next-view-transitions';
import { Music, Plus, Unlink, Download, ExternalLink, Loader2, Search, X, User, Star, FolderPlus, Trash, LayoutGrid, List, Disc3, RefreshCw } from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import SongItemCard from '@/components/SongItemCard';
import NowPlayingMetadata from '@/components/NowPlayingMetadata';
import Toast from '@/components/Toast';
import SpotifyLoginButton from '@/components/SpotifyLoginButton';
import { useI18n } from '@/lib/i18n';
import type { SongItem } from '@/lib/types';
import { importErrorMsg } from '@/lib/import-errors';
import SongFilterBar, { type SongViewMode } from '@/components/home/SongFilterBar';
import CollectionsPanel from '@/components/home/CollectionsPanel';
import PlaylistImportDialog from '@/components/home/PlaylistImportDialog';
import { findBestMatch, isSongPlaying } from '@/lib/match';
import { useNowPlaying } from '@/hooks/useNowPlaying';
import { useAuthSession } from '@/lib/auth-session';
import { cacheSongCovers } from '@/lib/song-cover-cache';
import { buildManualCreateUrl } from '@/lib/song-prefill';
import { getCachedSongs, setCachedSongs } from '@/lib/song-list-cache';
import { requestSongList } from '@/lib/song-list-fetch';
import { groupSongsByAlbum } from '@/lib/song-albums';

type ToastState = { type: 'success' | 'error'; msg: string } | null;
type ImportAlertState = { message: string; manualCreateUrl?: string } | null;
const EMPTY_SONG_IDS = new Set<string>();

const SONG_VIEW_MODE_KEY = 'jplrc:songs:view-mode';

function getSongViewMode(): SongViewMode {
  if (typeof window === 'undefined') return 'list';
  try {
    const saved = window.localStorage.getItem(SONG_VIEW_MODE_KEY);
    return saved === 'grid' || saved === 'album' ? saved : 'list';
  } catch {
    return 'list';
  }
}

export default function HomePage() {
  const { t, bcp47 } = useI18n();
  const searchParams = useSearchParams();
  const [initialSongs] = useState(() => getCachedSongs<SongItem>());
  const [songs, setSongs] = useState<SongItem[]>(() => initialSongs ?? []);
  const [loading, setLoading] = useState(() => initialSongs === null);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { session, updateSession } = useAuthSession();
  // A cached session renders immediately; the hook revalidates it on every page entry.
  const spotify = session?.spotify ?? null;
  const currentUser = session?.user ?? null;
  const { data: nowPlaying, syncState: nowPlayingSync, resumeSync: resumeNowPlaying } = useNowPlaying(!!spotify?.connected);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<ToastState>(() => {
    const error = searchParams.get('spotify_error');
    const success = searchParams.get('spotify');
    if (error) {
      const keyMap: Record<string, string> = {
        denied: 'home.spotifyDenied',
        token_failed: 'home.spotifyTokenFailed',
        no_identity: 'home.spotifyNoIdentity',
        blocked: 'home.spotifyBlocked',
        invalid_profile: 'home.spotifyInvalidProfile',
        passphrase_required: 'home.spotifyPassphraseRequired',
      };
      return { type: 'error', msg: t(keyMap[error] || 'home.spotifyTokenFailed') };
    }
    return success === 'connected' ? { type: 'success', msg: t('home.spotifyConnected') } : null;
  });
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [importAlert, setImportAlert] = useState<ImportAlertState>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [songViewMode, setSongViewMode] = useState<SongViewMode>(getSongViewMode);
  const [mySongsOnly, setMySongsOnly] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [showPlaylistImport, setShowPlaylistImport] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [collections, setCollections] = useState<{ id: string; name: string; songCount: number }[]>([]);
  const [filterCollection, setFilterCollection] = useState<string | null>(null);
  const [collectionSongs, setCollectionSongs] = useState<Set<string>>(new Set());
  const router = useRouter();
  const transitionRouter = useTransitionRouter();
  const nowPlayingCardRef = useRef<HTMLDivElement>(null);
  const updateNowPlayingPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const card = nowPlayingCardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--now-playing-pointer-x', `${event.clientX - rect.left}px`);
    card.style.setProperty('--now-playing-pointer-y', `${event.clientY - rect.top}px`);
  };
  const setNowPlayingTouching = (touching: boolean) => {
    const card = nowPlayingCardRef.current;
    if (!card) return;
    if (touching) card.dataset.touching = 'true';
    else delete card.dataset.touching;
  };
  const handleNowPlayingPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    updateNowPlayingPointer(event);
    if (event.pointerType === 'touch') setNowPlayingTouching(true);
  };
  const handleNowPlayingPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') setNowPlayingTouching(false);
  };
  const handleNowPlayingPointerCancel = () => setNowPlayingTouching(false);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
  };

  const applySongListResult = useCallback((result: { songs: SongItem[]; ok: boolean }) => {
    // setState only happens inside a .then() callback (never synchronously in an
    // effect body), so react-hooks/set-state-in-effect stays satisfied.
    const { songs: data, ok } = result;
    if (ok) {
      setSongs(data);
      cacheSongCovers(data);
      setCachedSongs(data);
      setLoadError(false);
    } else {
      // Network / HTTP / invalid-body failure: keep current list & cache.
      setLoadError(true);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  const retryLoad = (mode: 'all' | 'mine') => {
    // Event-handler path: safe to set in-flight state synchronously.
    // With cached data present keep the list visible (refreshing); without it,
    // fall back to the full loading skeleton.
    if (songs.length === 0) setLoading(true);
    setRefreshing(true);
    void requestSongList(mode).then(applySongListResult);
  };

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // ─── Handle Spotify OAuth redirect params ───
  useEffect(() => {
    const error = searchParams.get('spotify_error');
    const success = searchParams.get('spotify');

    if (error || success) {
      // The initial toast was derived during state initialization; only clean the URL here.
      const url = new URL(window.location.href);
      url.searchParams.delete('spotify_error');
      url.searchParams.delete('spotify');
      window.history.replaceState({}, '', url.pathname + url.search);
    }
  }, [searchParams]);

  useEffect(() => {
    if (initialSongs) cacheSongCovers(initialSongs);
    void requestSongList('all').then(applySongListResult);
  }, [initialSongs, applySongListResult]);

  useEffect(() => {
    if (!currentUser?.email) return;
    // Cached identity may be shown first; refresh-backed state re-runs this only when it changed.
    fetch('/api/songs?favorites=1').then(r => r.json()).then(favs => {
      setFavorites(new Set(favs.map((f: { id: string }) => f.id)));
    }).catch(() => {});
    fetch('/api/collections').then(r => r.json()).then(setCollections).catch(() => {});
  }, [currentUser?.email]);

  // Re-fetch songs when "my songs" toggle changes
  useEffect(() => {
    void requestSongList(mySongsOnly ? 'mine' : 'all').then(applySongListResult);
  }, [mySongsOnly, applySongListResult]);

  useEffect(() => {
    if (!filterCollection) return;
    fetch(`/api/collections/${filterCollection}/songs`)
      .then((r) => r.json())
      .then((data) => setCollectionSongs(new Set(data.map((s: { id: string }) => s.id))))
      .catch(() => setCollectionSongs(new Set()));
  }, [filterCollection]);

  const handleDelete = (id: string, title: string) => {
    setDeleteTarget({ id, title });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const res = await fetch(`/api/songs/${deleteTarget.id}`, { method: 'DELETE' });
    if (res.ok) {
      setSongs((prev) => prev.filter((s) => s.id !== deleteTarget.id));
      showToast('success', t('home.deleted'));
    }
    setDeleteTarget(null);
  };

  const handleDisconnect = async () => {
    const response = await fetch('/api/spotify/status', { method: 'DELETE' });
    if (response.ok) updateSession({ user: null, spotify: { connected: false } });
  };

  const handleImport = async () => {
    if (!nowPlaying?.track) return;
    setImporting(true);
    try {
      const res = await fetch('/api/songs/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: nowPlaying.track.name, artist: nowPlaying.track.artist, spotify_track_id: nowPlaying.track.id }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setImportAlert({
          message: importErrorMsg(t, data.error, 'home.importErrorDefault'),
          manualCreateUrl: buildManualCreateUrl(data),
        });
        return;
      }
      router.push(`/songs/${data.id}`);
    } catch {
      showToast('error', t('home.importFailed'));
    } finally {
      setImporting(false);
    }
  };

  const handlePlaylistImported = (songs: SongItem[]) => {
    setSongs(songs);
    cacheSongCovers(songs);
    setCachedSongs(songs);
  };

  const handleToggleFavorite = async (songId: string) => {
    try {
      const res = await fetch(`/api/songs/${songId}/favorite`, { method: 'POST' });
      const data = await res.json();
      setFavorites((prev) => {
        const next = new Set(prev);
        if (data.favorited) next.add(songId);
        else next.delete(songId);
        return next;
      });
    } catch { /* */ }
  };

  const handleCreateCollection = async (name: string) => {
    try {
      const res = await fetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const data = await res.json();
        setCollections((prev) => [...prev, { ...data, songCount: 0 }]);
      }
    } catch { /* */ }
  };

  const handleDeleteCollection = async (collectionId: string) => {
    try {
      await fetch(`/api/collections/${collectionId}`, { method: 'DELETE' });
      setCollections((prev) => prev.filter((c) => c.id !== collectionId));
      if (filterCollection === collectionId) setFilterCollection(null);
    } catch { /* */ }
  };

  // Find matching song in DB for currently playing track (uses title + artist scoring)
  const matchedSong = findBestMatch(songs, nowPlaying?.track, currentUser?.email);
  const visibleFavorites = currentUser ? favorites : EMPTY_SONG_IDS;
  const visibleCollection = currentUser ? filterCollection : null;
  const visibleCollectionSongs = visibleCollection ? collectionSongs : EMPTY_SONG_IDS;

  // Filter songs by search query (mySongsOnly is handled server-side via ?mine=1)
  const filteredSongs = songs.filter((s) => {
    if (currentUser && favoritesOnly && !visibleFavorites.has(s.id)) return false;
    if (visibleCollection && !visibleCollectionSongs.has(s.id)) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q);
    }
    return true;
  });
  const albumView = songViewMode === 'album' ? groupSongsByAlbum(filteredSongs) : { entries: [], unclassified: [] };
  const visibleSongIds = filteredSongs.map((song) => song.id).join(',');
  const songListRef = useRef<HTMLDivElement>(null);
  const previousSongRectsRef = useRef<Map<string, DOMRect>>(new Map());

  useLayoutEffect(() => {
    const list = songListRef.current;
    if (!list) return;

    const currentRects = new Map<string, DOMRect>();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    list.querySelectorAll<HTMLElement>('[data-song-card-id]').forEach((element) => {
      const id = element.dataset.songCardId;
      if (!id) return;
      const nextRect = element.getBoundingClientRect();
      currentRects.set(id, nextRect);

      const previousRect = previousSongRectsRef.current.get(id);
      if (!reduceMotion && previousRect) {
        const deltaX = previousRect.left - nextRect.left;
        const deltaY = previousRect.top - nextRect.top;
        if (deltaX || deltaY) {
          element.animate(
            [
              { transform: `translate(${deltaX}px, ${deltaY}px)` },
              { transform: 'translate(0, 0)' },
            ],
            { duration: 360, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
          );
        }
      } else if (!reduceMotion && previousSongRectsRef.current.size > 0) {
        element.animate(
          [
            { opacity: 0, transform: 'translateY(8px) scale(0.985)' },
            { opacity: 1, transform: 'translateY(0) scale(1)' },
          ],
          { duration: 280, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
        );
      }
    });

    previousSongRectsRef.current = currentRects;
  }, [songViewMode, visibleSongIds]);

  const changeSongViewMode = (mode: SongViewMode) => {
    setSongViewMode(mode);
    try {
      localStorage.setItem(SONG_VIEW_MODE_KEY, mode);
    } catch {}
  };

  const renderSongCard = (song: SongItem, variant: 'list' | 'grid', hideCover = false) => {
    const isPlaying = nowPlaying?.is_playing && isSongPlaying(song, nowPlaying.track, currentUser?.email);
    return (
      <SongItemCard
        key={song.id}
        song={song}
        variant={variant}
        hideCover={hideCover}
        isPlaying={isPlaying}
        spotifyConnected={!!spotify?.connected}
        isFavorite={visibleFavorites.has(song.id)}
        locale={bcp47}
        unknownArtistLabel={t('common.unknownArtist')}
        createdByLabel={t('home.createdBy')}
        shareLabel={t('song.share')}
        onOpen={() => transitionRouter.push(`/songs/${song.id}`)}
        onPrefetch={() => {
          if ('connection' in navigator && (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData !== true) {
            fetch(`/api/songs/${song.id}`).catch(() => {});
          }
        }}
        onToggleFavorite={() => handleToggleFavorite(song.id)}
        onShare={() => router.push(`/songs/${song.id}/share`)}
        onDelete={() => handleDelete(song.id, song.title)}
      />
    );
  };

  return (
    <div className="fade-in">
      {/* Header */}
      <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{t('home.songList')}</h1>
          <p className="text-xs text-[var(--muted-foreground)] mt-1">{t('home.songCount', { count: filteredSongs.length })}{(searchQuery || mySongsOnly || favoritesOnly) && filteredSongs.length !== songs.length ? ` / ${songs.length}` : ''}</p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
          {spotify === null ? null : spotify.connected ? (
            <div className="flex items-center gap-2 flex-1 sm:flex-none">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
              <span className="text-xs text-[var(--muted-foreground)] truncate">{spotify.display_name}</span>
              <button onClick={handleDisconnect} className="text-[var(--muted-foreground)] hover:text-[var(--destructive)] transition-colors" title={t('home.disconnect')}>
                <Unlink className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <SpotifyLoginButton className="inline-flex items-center gap-1.5 rounded-md bg-[#1DB954] px-3 py-2 text-xs font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-60 flex-1 sm:flex-none justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" /></svg>
              <span>Spotify</span>
            </SpotifyLoginButton>
          )}
          <button onClick={() => router.push('/songs/new')} disabled={!spotify?.connected} className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-3 sm:px-4 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed">
            <Plus className="h-3.5 w-3.5" />
            <span>{t('common.new')}</span>
          </button>
          {spotify?.connected && (
            <button
              onClick={() => setShowPlaylistImport(!showPlaylistImport)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                showPlaylistImport
                  ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                  : 'bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
              title={t('home.playlistImport')}
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('home.playlistImport')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Playlist Import */}
      <PlaylistImportDialog
        open={showPlaylistImport}
        onClose={() => setShowPlaylistImport(false)}
        onImported={handlePlaylistImported}
      />

      {/* Search & Filter: mobile keeps controls on one compact row and expands search on demand. */}
      <SongFilterBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        mobileSearchOpen={mobileSearchOpen}
        onToggleMobileSearch={() => setMobileSearchOpen((open) => !open)}
        showUserFilters={!!currentUser}
        favoritesOnly={favoritesOnly}
        onToggleFavorites={() => setFavoritesOnly(!favoritesOnly)}
        mySongsOnly={mySongsOnly}
        onToggleMine={() => setMySongsOnly(!mySongsOnly)}
        viewMode={songViewMode}
        onViewModeChange={changeSongViewMode}
      />

      {/* Collections */}
      {currentUser && collections.length > 0 && (
        <CollectionsPanel
          collections={collections}
          filterCollection={filterCollection}
          onFilterChange={setFilterCollection}
          onDelete={handleDeleteCollection}
          onCreate={handleCreateCollection}
        />
      )}

      {/* Now Playing bar */}
      <div className={`now-playing-slot ${nowPlaying?.is_playing && nowPlaying.track ? 'now-playing-slot--visible' : ''}`}>
        <div className="now-playing-reveal">
          {nowPlaying?.is_playing && nowPlaying.track && (
            <div
              ref={nowPlayingCardRef}
              className="now-playing-card rounded-lg bg-[var(--card)] border border-[var(--border)] p-3 sm:p-4 flex items-center gap-3"
              onPointerEnter={updateNowPlayingPointer}
              onPointerMove={updateNowPlayingPointer}
              onPointerDown={handleNowPlayingPointerDown}
              onPointerUp={handleNowPlayingPointerUp}
              onPointerCancel={handleNowPlayingPointerCancel}
              onPointerLeave={handleNowPlayingPointerCancel}
            >
              <div className="relative shrink-0">
                <Music className="h-5 w-5 text-[var(--success)]" />
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-[var(--success)] animate-pulse" />
              </div>
              <NowPlayingMetadata track={nowPlaying.track} />
              {matchedSong ? (
                <button
                  onClick={() => router.push(`/songs/${matchedSong.id}`)}
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-[var(--muted-foreground)] bg-[var(--accent)] hover:text-[var(--foreground)] transition-colors shrink-0"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t('home.view')}</span>
                </button>
              ) : spotify?.connected ? (
                <button
                  onClick={handleImport}
                  disabled={importing}
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-[var(--primary)] text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50 shrink-0"
                >
                  {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  <span>{importing ? t('home.importing') : t('home.import')}</span>
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Degraded sync banner (always visible, outside the collapsing now-playing slot) */}
      {nowPlayingSync === 'stopped' && (
        <div className="mb-5 rounded-lg bg-[var(--card)] border border-[var(--warning)]/40 p-3 sm:p-4 flex items-center gap-3">
          <span className="inline-block h-2 w-2 rounded-full bg-[var(--warning)]" />
          <span className="text-xs text-[var(--warning)] truncate">{t('song.syncStopped')}</span>
          <button
            onClick={() => void resumeNowPlaying()}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-[var(--primary)] text-[var(--primary-foreground)] transition-opacity hover:opacity-90 shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>{t('song.resumeSync')}</span>
          </button>
        </div>
      )}
      {nowPlayingSync === 'retrying' && (
        <div className="mb-5 rounded-lg bg-[var(--card)] border border-[var(--warning)]/30 p-3 sm:p-4 flex items-center gap-3">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--warning)]" />
          <span className="text-xs text-[var(--warning)] truncate">{t('song.syncRetrying')}</span>
        </div>
      )}

      {/* Degraded cache banner: current list is cached/stale because refresh failed */}
      {loadError && !loading && songs.length > 0 && (
        <div className="mb-5 rounded-lg bg-[var(--card)] border border-[var(--warning)]/40 p-3 sm:p-4 flex items-center gap-3">
          <span className="inline-block h-2 w-2 rounded-full bg-[var(--warning)]" />
          <span className="text-xs text-[var(--warning)] truncate">{t('home.cachedData')}</span>
          <button
            onClick={() => retryLoad(mySongsOnly ? 'mine' : 'all')}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-[var(--primary)] text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-60 shrink-0"
          >
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            <span>{t('home.retry')}</span>
          </button>
        </div>
      )}

      {/* Song list */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-16 rounded-lg bg-[var(--muted)] animate-pulse" />)}
        </div>
      ) : loadError && songs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <RefreshCw className="h-10 w-10 mb-4 text-[var(--muted-foreground)] opacity-20" />
          <p className="text-sm text-[var(--muted-foreground)]">{t('home.loadFailed')}</p>
          <button
            onClick={() => retryLoad(mySongsOnly ? 'mine' : 'all')}
            disabled={refreshing}
            className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-2 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} {t('home.retry')}
          </button>
        </div>
      ) : songs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Music className="h-10 w-10 mb-4 text-[var(--muted-foreground)] opacity-20" />
          <p className="text-sm text-[var(--muted-foreground)]">{t('home.noSongs')}</p>
          <button onClick={() => router.push('/songs/new')} disabled={!spotify?.connected} className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-2 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            <Plus className="h-3.5 w-3.5" /> {t('home.addFirst')}
          </button>
        </div>
      ) : filteredSongs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Search className="h-8 w-8 mb-3 text-[var(--muted-foreground)] opacity-20" />
          <p className="text-sm text-[var(--muted-foreground)]">{t('home.noResults')}</p>
        </div>
      ) : (
        <div ref={songListRef} className={songViewMode === 'grid' ? 'song-grid grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4' : 'space-y-1.5 sm:space-y-2'}>
          {songViewMode === 'album' ? (<>
            {albumView.entries.map((entry) => {
              if (entry.type !== 'group') return null;
              const group = entry.group;
              const coverUrl = group.songs.find((song) => song.cover_url)?.cover_url;
              return (
                <section key={group.key} className="album-group rounded-lg border border-[var(--border)] bg-[var(--card)]/40 p-2.5 sm:p-3">
                  <header className="mb-2.5 flex min-w-0 items-center gap-2.5 px-1">
                    {coverUrl ? (
                      <img src={coverUrl} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover bg-[var(--muted)]" loading="lazy" />
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--accent)] text-[var(--muted-foreground)]"><Disc3 className="h-4 w-4" /></div>
                    )}
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-sm font-semibold tracking-tight">{group.album}</h2>
                      <p className="truncate text-xs text-[var(--muted-foreground)]">{group.artist ? `${group.artist} · ${t('home.albumTrackCount', { count: group.songs.length })}` : t('home.albumTrackCount', { count: group.songs.length })}</p>
                    </div>
                  </header>
                  <div className="space-y-1.5">{group.songs.map((song) => renderSongCard(song, 'list', true))}</div>
                </section>
              );
            })}
            {albumView.unclassified.map((song) => renderSongCard(song, 'list'))}
          </>) : filteredSongs.map((song) => renderSongCard(song, songViewMode))}
        </div>
      )}

      {toast && <Toast type={toast.type} message={toast.msg} />}

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('dialog.deleteConfirmTitle', { title: deleteTarget?.title || '' })}
        body={t('dialog.deleteConfirmBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={!!importAlert}
        title={t('home.importErrorTitle')}
        body={importAlert?.message}
        confirmLabel={importAlert?.manualCreateUrl ? t('home.createManually') : t('common.confirm')}
        cancelLabel={importAlert?.manualCreateUrl ? t('common.cancel') : undefined}
        alert={!importAlert?.manualCreateUrl}
        onConfirm={() => {
          const url = importAlert?.manualCreateUrl;
          setImportAlert(null);
          if (url) router.push(url);
        }}
        onCancel={() => setImportAlert(null)}
      />
    </div>
  );
}
