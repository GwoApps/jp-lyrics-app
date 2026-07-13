'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransitionRouter } from 'next-view-transitions';
import { Music, Pencil, Trash2, Plus, Unlink, Download, ExternalLink, Loader2, Search, X, User, Star, FolderPlus, Trash } from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import CoverImage from '@/components/CoverImage';
import { useI18n } from '@/lib/i18n';
import { findBestMatch, isSongPlaying } from '@/lib/match';
import { useNowPlaying } from '@/hooks/useNowPlaying';

interface SongItem {
  id: string;
  title: string;
  artist: string;
  cover_url?: string | null;
  created_by: string;
  created_by_name: string;
  is_public: number;
  created_at: string;
  updated_at: string;
}

interface SpotifyStatus {
  connected: boolean;
  display_name?: string;
}

function localeToBCP47(locale: string): string {
  const map: Record<string, string> = { ja: 'ja-JP', en: 'en-US', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW' };
  return map[locale] ?? 'ja-JP';
}

const importErrorKeyMap: Record<string, string> = {
  title_required: 'home.importTitleRequired',
  lyrics_not_found: 'home.importLyricsNotFound',
  login_required: 'home.importLoginRequired',
  invalid_playlist_url: 'home.importInvalidPlaylistUrl',
  spotify_not_connected: 'home.importSpotifyNotConnected',
  playlist_fetch_failed: 'home.importPlaylistFetchFailed',
  playlist_empty: 'home.importPlaylistEmpty',
};

function importErrorMsg(t: (k: string) => string, error?: string, fallbackKey?: string): string {
  if (!error) return fallbackKey ? t(fallbackKey) : error || '';
  const key = importErrorKeyMap[error];
  return key ? t(key) : error;
}

export default function HomePage() {
  const { t, locale } = useI18n();
  const [songs, setSongs] = useState<SongItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [spotify, setSpotify] = useState<SpotifyStatus | null>(null);
  const nowPlaying = useNowPlaying(!!spotify?.connected);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [importAlert, setImportAlert] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [mySongsOnly, setMySongsOnly] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ email: string; name: string; isAdmin: boolean } | null>(null);
  const [showPlaylistImport, setShowPlaylistImport] = useState(false);
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [playlistImporting, setPlaylistImporting] = useState(false);
  const [playlistResult, setPlaylistResult] = useState<{ total: number; imported: number; skipped: number; failed: number } | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [collections, setCollections] = useState<{ id: string; name: string; songCount: number }[]>([]);
  const [showCollections, setShowCollections] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [filterCollection, setFilterCollection] = useState<string | null>(null);
  const [collectionSongs, setCollectionSongs] = useState<Set<string>>(new Set());
  const router = useRouter();
  const transitionRouter = useTransitionRouter();
  const searchParams = useSearchParams();

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  };

  // ─── Handle Spotify OAuth redirect params ───
  useEffect(() => {
    const error = searchParams.get('spotify_error');
    const success = searchParams.get('spotify');

    if (error || success) {
      // Clean URL params immediately
      const url = new URL(window.location.href);
      url.searchParams.delete('spotify_error');
      url.searchParams.delete('spotify');
      window.history.replaceState({}, '', url.pathname + url.search);

      if (error) {
        const keyMap: Record<string, string> = {
          denied: 'home.spotifyDenied',
          token_failed: 'home.spotifyTokenFailed',
          no_identity: 'home.spotifyNoIdentity',
          blocked: 'home.spotifyBlocked',
          invalid_profile: 'home.spotifyInvalidProfile',
        };
        showToast('error', t(keyMap[error] || 'home.spotifyTokenFailed'));
      } else if (success === 'connected') {
        showToast('success', t('home.spotifyConnected'));
      }
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch('/api/songs')
      .then((r) => r.json())
      .then((data) => { setSongs(data); setLoading(false); })
      .catch(() => setLoading(false));

    fetch('/api/spotify/status')
      .then((r) => r.json())
      .then((data) => setSpotify(data))
      .catch(() => {});

    fetch('/api/me')
      .then((r) => r.json())
      .then((data) => {
        if (data.authenticated) {
          setCurrentUser({ email: data.email, name: data.name, isAdmin: data.isAdmin });
          // Fetch favorites and collections for authenticated users
          fetch('/api/songs?favorites=1').then(r => r.json()).then(favs => {
            setFavorites(new Set(favs.map((f: { id: string }) => f.id)));
          }).catch(() => {});
          fetch('/api/collections').then(r => r.json()).then(setCollections).catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  // Re-fetch songs when "my songs" toggle changes
  useEffect(() => {
    const params = mySongsOnly ? '?mine=1' : '';
    fetch(`/api/songs${params}`)
      .then((r) => r.json())
      .then((data) => setSongs(data))
      .catch(() => {});
  }, [mySongsOnly]);

  useEffect(() => {
    if (!filterCollection) {
      setCollectionSongs(new Set());
      return;
    }
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
    await fetch('/api/spotify/status', { method: 'DELETE' });
    setSpotify({ connected: false });
  };

  const handleImport = async () => {
    if (!nowPlaying?.track) return;
    setImporting(true);
    try {
      const res = await fetch('/api/songs/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: nowPlaying.track.name, artist: nowPlaying.track.artist }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setImportAlert(importErrorMsg(t, data.error, 'home.importErrorDefault'));
        return;
      }
      router.push(`/songs/${data.id}`);
    } catch {
      showToast('error', t('home.importFailed'));
    } finally {
      setImporting(false);
    }
  };

  const handlePlaylistImport = async () => {
    if (!playlistUrl.trim()) return;
    setPlaylistImporting(true);
    setPlaylistResult(null);
    try {
      const res = await fetch('/api/songs/import-playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlistUrl: playlistUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setImportAlert(importErrorMsg(t, data.error, 'home.playlistImportError'));
        return;
      }
      setPlaylistResult(data);
      // Refresh song list
      const songsRes = await fetch('/api/songs');
      if (songsRes.ok) setSongs(await songsRes.json());
    } catch {
      showToast('error', t('home.playlistImportFailed'));
    } finally {
      setPlaylistImporting(false);
    }
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

  const handleCreateCollection = async () => {
    if (!newCollectionName.trim()) return;
    try {
      const res = await fetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCollectionName.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setCollections((prev) => [...prev, { ...data, songCount: 0 }]);
        setNewCollectionName('');
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

  // Filter songs by search query (mySongsOnly is handled server-side via ?mine=1)
  const filteredSongs = songs.filter((s) => {
    if (favoritesOnly && !favorites.has(s.id)) return false;
    if (filterCollection && !collectionSongs.has(s.id)) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="fade-in">
      {/* Header */}
      <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{t('home.songList')}</h1>
          <p className="text-xs text-[var(--muted-foreground)] mt-1">{t('home.songCount', { count: filteredSongs.length })}{(searchQuery || mySongsOnly || favoritesOnly) && filteredSongs.length !== songs.length ? ` / ${songs.length}` : ''}</p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
          {spotify?.connected ? (
            <div className="flex items-center gap-2 flex-1 sm:flex-none">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
              <span className="text-xs text-[var(--muted-foreground)] truncate">{spotify.display_name}</span>
              <button onClick={handleDisconnect} className="text-[var(--muted-foreground)] hover:text-[var(--destructive)] transition-colors" title={t('home.disconnect')}>
                <Unlink className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <a href="/api/auth/login" className="inline-flex items-center gap-1.5 rounded-md bg-[#1DB954] px-3 py-2 text-xs font-medium text-black transition-opacity hover:opacity-90 flex-1 sm:flex-none justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" /></svg>
              <span>Spotify</span>
            </a>
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
      {showPlaylistImport && (
        <div className="mb-4 rounded-lg bg-[var(--card)] border border-[var(--border)] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Download className="h-4 w-4 text-[var(--primary)]" />
            <span className="text-sm font-medium">{t('home.playlistImportTitle')}</span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={playlistUrl}
              onChange={(e) => setPlaylistUrl(e.target.value)}
              placeholder={t('home.playlistUrlPlaceholder')}
              className="flex-1 rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-xs outline-none focus:border-[var(--primary)] transition-colors placeholder:text-[var(--muted-foreground)]/50"
              disabled={playlistImporting}
            />
            <button
              onClick={handlePlaylistImport}
              disabled={playlistImporting || !playlistUrl.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-4 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {playlistImporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              <span>{playlistImporting ? t('home.playlistImporting') : t('home.playlistImportBtn')}</span>
            </button>
          </div>
          {playlistResult && (
            <div className="mt-3 text-xs text-[var(--muted-foreground)]">
              {t('home.playlistImportResult', {
                total: String(playlistResult.total),
                imported: String(playlistResult.imported),
                skipped: String(playlistResult.skipped),
                failed: String(playlistResult.failed),
              })}
            </div>
          )}
        </div>
      )}

      {/* Search & Filter */}
      <div className="mb-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('home.search')}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] pl-9 pr-8 py-2 text-xs outline-none focus:border-[var(--primary)] transition-colors placeholder:text-[var(--muted-foreground)]/50"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {currentUser && (
          <div className="flex gap-2">
            <button
              onClick={() => setFavoritesOnly(!favoritesOnly)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors shrink-0 ${
                favoritesOnly
                  ? 'bg-[var(--warning)]/20 text-[var(--warning)]'
                  : 'bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              <Star className={`h-3.5 w-3.5 ${favoritesOnly ? 'fill-current' : ''}`} />
              <span>{t('home.favorites')}</span>
            </button>
            <button
              onClick={() => setMySongsOnly(!mySongsOnly)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors shrink-0 ${
                mySongsOnly
                  ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                  : 'bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              <User className="h-3.5 w-3.5" />
              <span>{t('home.mine')}</span>
            </button>
          </div>
        )}
      </div>

      {/* Collections */}
      {currentUser && collections.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowCollections(!showCollections)}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--accent)] transition-colors"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            <span>{t('home.collections')}</span>
          </button>
          {filterCollection && (
            <button
              onClick={() => setFilterCollection(null)}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--primary)]/20 text-[var(--primary)] px-2.5 py-1 text-[10px] font-medium"
            >
              {collections.find(c => c.id === filterCollection)?.name}
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      {/* Collections Panel */}
      {showCollections && currentUser && (
        <div className="mb-4 rounded-lg bg-[var(--card)] border border-[var(--border)] p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">{t('home.collectionsTitle')}</span>
            <button onClick={() => setShowCollections(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              placeholder={t('home.newCollectionPlaceholder')}
              className="flex-1 rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-1.5 text-xs outline-none focus:border-[var(--primary)] transition-colors"
              onKeyDown={(e) => e.key === 'Enter' && handleCreateCollection()}
            />
            <button
              onClick={handleCreateCollection}
              disabled={!newCollectionName.trim()}
              className="rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] disabled:opacity-50"
            >
              {t('home.createCollection')}
            </button>
          </div>
          <div className="space-y-1">
            {collections.map((c) => (
              <div
                key={c.id}
                className={`flex items-center justify-between rounded-md px-3 py-2 text-xs cursor-pointer transition-colors ${
                  filterCollection === c.id ? 'bg-[var(--primary)]/10 text-[var(--primary)]' : 'hover:bg-[var(--accent)]'
                }`}
                onClick={() => setFilterCollection(filterCollection === c.id ? null : c.id)}
              >
                <span>{c.name} ({c.songCount})</span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteCollection(c.id); }}
                  className="text-[var(--muted-foreground)] hover:text-[var(--destructive)]"
                >
                  <Trash className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Now Playing bar */}
      {nowPlaying?.is_playing && nowPlaying.track && (
        <div className="mb-5 sm:mb-6 rounded-lg bg-[var(--card)] border border-[var(--border)] p-3 sm:p-4 flex items-center gap-3">
          <div className="relative shrink-0">
            <Music className="h-5 w-5 text-[var(--success)]" />
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-[var(--success)] animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{nowPlaying.track.name}</div>
            <div className="text-xs text-[var(--muted-foreground)] truncate">{nowPlaying.track.artist}</div>
          </div>
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

      {/* Song list */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-16 rounded-lg bg-[var(--muted)] animate-pulse" />)}
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
        <div className="space-y-1.5 sm:space-y-2">
          {filteredSongs.map((song) => {
            const isPlaying = nowPlaying?.is_playing && isSongPlaying(song, nowPlaying.track, currentUser?.email);
            return (
              <div key={song.id} className={`group flex items-center gap-3 sm:gap-4 rounded-lg bg-[var(--card)] border px-4 sm:px-5 py-3 sm:py-4 transition-colors hover:bg-[var(--muted)] cursor-pointer ${isPlaying ? 'border-[var(--success)]/50 bg-[var(--success-muted)]' : 'border-[var(--border)]'}`} onClick={() => transitionRouter.push(`/songs/${song.id}`)}>
                <CoverImage src={song.cover_url} alt={song.title} size="sm" viewTransitionName={`song-cover-${song.id}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate flex items-center gap-2">
                    {song.title}
                    {isPlaying && <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--success)] animate-pulse shrink-0" />}
                  </div>
                  <div className="text-xs text-[var(--muted-foreground)] mt-0.5 truncate">{song.artist || t('common.unknownArtist')}</div>
                  {song.created_by_name && (
                    <div className="text-[10px] text-[var(--muted-foreground)]/60 mt-0.5 truncate">{t('home.createdBy')}: {song.created_by_name}</div>
                  )}
                </div>
                <div className="text-[10px] sm:text-[11px] text-[var(--muted-foreground)] hidden sm:block shrink-0">{new Date(song.updated_at).toLocaleDateString(localeToBCP47(locale))}</div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {spotify?.connected && (
                    <>
                      <button onClick={(e) => { e.stopPropagation(); handleToggleFavorite(song.id); }} className={`rounded p-1.5 sm:p-2 transition-colors ${favorites.has(song.id) ? 'text-[var(--warning)]' : 'text-[var(--muted-foreground)] hover:text-[var(--warning)]'}`}>
                        <Star className={`h-3.5 w-3.5 ${favorites.has(song.id) ? 'fill-current' : ''}`} />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); router.push(`/songs/${song.id}/edit`); }} className="rounded p-1.5 sm:p-2 text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--accent)] transition-colors">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); handleDelete(song.id, song.title); }} className="rounded p-1.5 sm:p-2 text-[var(--destructive)] hover:bg-[var(--destructive)]/10 transition-colors">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

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
        body={importAlert || undefined}
        confirmLabel={t('common.confirm')}
        alert
        onConfirm={() => setImportAlert(null)}
      />
    </div>
  );
}
