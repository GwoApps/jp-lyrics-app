'use client';

import { ChevronRight } from 'lucide-react';
import { useId, useLayoutEffect, useState, type KeyboardEvent } from 'react';
import ArtistLinks from '@/components/ArtistLinks';
import ArtistBackButton from '@/components/artists/ArtistBackButton';
import CoverImage from '@/components/CoverImage';
import FavoriteCategoriesDialog from '@/components/home/FavoriteCategoriesDialog';
import SpotifyLoginButton from '@/components/SpotifyLoginButton';
import { refreshAuthSession, useAuthSession } from '@/lib/auth-session';
import { useI18n } from '@/lib/i18n';
import ArtistProfileHeader from './ArtistProfileHeader';
import ArtistLibraryControls from './ArtistLibraryControls';
import ArtistLibrarySongs from './ArtistLibrarySongs';
import { defaultLibraryView, filterArtistSongs, groupMatchingAlbums, readFavoriteStatus, type ArtistLibrarySong } from './artist-library-model';
import { createFavoriteReadbackGate } from './favorite-readback';
import { useArtistLibraryView } from './useArtistLibraryView';
import { useArtistDetailMotion } from './useArtistDetailMotion';
import type { LibraryTab } from './detail-motion';
import { useArtistResource, validArtistLibrary } from './useArtistResource';
import './artists.css';
import './artists-detail-motion.css';
import './artist-library.css';

function ArtistDetailLoading() {
  const { t } = useI18n();
  return <div className="artist-detail-loading" role="status" aria-busy="true">
    <span className="artist-detail-loading-label">{t('common.loading')}</span>
    <ul className="artist-songs" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => (
      <li key={index} className="artist-song artist-song-skeleton">
        <span className="artist-song-skeleton-cover" />
        <span className="artist-song-skeleton-copy"><span /><span /></span>
      </li>
    ))}</ul>
  </div>;
}

function ArtistDetailContent({ name, signedIn }: { name: string; signedIn: boolean }) {
  const { t, locale } = useI18n();
  const { state, retry } = useArtistResource(`/api/artists/${encodeURIComponent(name)}`, validArtistLibrary);
  const tabId = useId();
  const data = state.status === 'ready' ? state.data : null;
  const { view, updateView, saveBeforeNavigation } = useArtistLibraryView(name, !!data);
  const { tab, outgoingTab, selectTab, panelsRef } = useArtistDetailMotion(data);
  const [favoriteSong, setFavoriteSong] = useState<ArtistLibrarySong | null>(null);
  const [favoriteOverrides, setFavoriteOverrides] = useState<Record<string, boolean | null>>({});
  const [favoriteReadbacks] = useState(createFavoriteReadbackGate);
  const [favoriteError, setFavoriteError] = useState<{ songId: string; loginRequired: boolean } | null>(null);
  const songs = data ? filterArtistSongs(data.songs, view, locale) : [];
  const albums = groupMatchingAlbums(songs, view.sort, locale);
  const tabs: LibraryTab[] = ['songs', 'albums'];

  useLayoutEffect(() => {
    // Restore selection through the existing native-snapshot motion hook, before
    // fetched panels arrive. Do not replace its arrival/transition sequencing.
    if (tab !== view.tab) selectTab(view.tab);
  }, [tab, view.tab, selectTab]);
  const changeTab = (next: LibraryTab) => { updateView({ tab: next }); selectTab(next); };
  const selectTabWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    let next: LibraryTab | undefined;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') next = tab === 'songs' ? 'albums' : 'songs';
    if (event.key === 'Home') next = 'songs';
    if (event.key === 'End') next = 'albums';
    if (next) {
      event.preventDefault();
      changeTab(next);
      document.getElementById(`${tabId}-${next}`)?.focus();
    }
  };
  const reset = () => updateView({ ...defaultLibraryView(), tab: view.tab, expandedAlbumKeys: view.expandedAlbumKeys });
  const verifyFavorite = async (songId: string) => {
    const revision = favoriteReadbacks.begin(songId);
    setFavoriteError(null);
    try {
      const favorited = await readFavoriteStatus(songId);
      if (!favoriteReadbacks.isCurrent(songId, revision)) return;
      setFavoriteOverrides((previous) => ({ ...previous, [songId]: favorited }));
    } catch (error) {
      if (!favoriteReadbacks.isCurrent(songId, revision)) return;
      const loginRequired = error instanceof Error && error.message === 'login_required';
      setFavoriteOverrides((previous) => ({ ...previous, [songId]: null }));
      setFavoriteError({ songId, loginRequired });
      if (loginRequired) void refreshAuthSession().catch(() => {});
    }
  };
  const songList = (items: ArtistLibrarySong[]) => <ArtistLibrarySongs songs={items} signedIn={signedIn} favoriteOverrides={favoriteOverrides} onFavorite={(song) => { setFavoriteError(null); setFavoriteSong(song); }} />;
  const emptyFiltered = <div className="artists-state"><p>{t('artistLibrary.noMatches')}</p><button type="button" className="artists-button" onClick={reset}>{t('artistLibrary.reset')}</button></div>;

  return (
    <div className="artists-page artist-detail" onClickCapture={(event) => { if ((event.target as Element).closest('a[href], .artist-back-navigation button')) saveBeforeNavigation(); }}>
      <ArtistBackButton />
      <ArtistProfileHeader key={name} name={data?.artist.name ?? name} />
      {state.status === 'loading' && <ArtistDetailLoading />}
      {state.status === 'error' && <div className="artists-state" role="alert"><p>{t(state.notFound ? 'artists.notFound' : 'artists.detailLoadError')}</p><button type="button" className="artists-button" onClick={retry}>{t('common.reload')}</button></div>}
      {data && <>
        <p className="artist-library-scope">{t('artists.localLibrary')}<span>{t('home.songCount', { count: data.songs.length })}</span><span>{t('home.albumCount', { count: data.albums.length })}</span></p>
        <ArtistLibraryControls view={view} onChange={updateView} />
        <p className="artist-library-results" role="status">{t('artistLibrary.matchingCounts', { songs: songs.length, albums: albums.length })}</p>
        {favoriteError && <div className="artist-library-favorite-error" role="alert"><span>{t(favoriteError.loginRequired ? 'artistLibrary.loginToFavorite' : 'artistLibrary.favoriteReadFailed')}</span>{favoriteError.loginRequired ? <SpotifyLoginButton className="artists-text-button">{t('artistLibrary.login')}</SpotifyLoginButton> : <button type="button" className="artists-text-button" onClick={() => void verifyFavorite(favoriteError.songId)}>{t('common.reload')}</button>}</div>}
        <div className="artist-tabs" role="tablist" aria-label={t('artists.localLibrary')}>
          {tabs.map((value) => <button key={value} id={`${tabId}-${value}`} type="button" role="tab" aria-selected={tab === value} aria-controls={`${tabId}-${value}-panel`} tabIndex={tab === value ? 0 : -1} onKeyDown={selectTabWithKeyboard} onClick={() => changeTab(value)}>{t(value === 'songs' ? 'artists.songsTab' : 'artists.albumsTab')}<span>{value === 'songs' ? songs.length : albums.length}</span></button>)}
        </div>
        <div className="artist-tab-panels" ref={panelsRef}>
        <section className="artist-tab-panel" data-artist-panel="songs" data-outgoing={outgoingTab === 'songs' || undefined} role="tabpanel" id={`${tabId}-songs-panel`} aria-labelledby={`${tabId}-songs`} hidden={tab !== 'songs' && outgoingTab !== 'songs'} aria-hidden={tab !== 'songs' || undefined} inert={tab !== 'songs'} tabIndex={tab === 'songs' ? 0 : -1}>
          {songs.length ? songList(songs) : data.songs.length ? emptyFiltered : <p className="artists-state">{t('artists.noSongs')}</p>}
        </section>
        <section className="artist-tab-panel" data-artist-panel="albums" data-outgoing={outgoingTab === 'albums' || undefined} role="tabpanel" id={`${tabId}-albums-panel`} aria-labelledby={`${tabId}-albums`} hidden={tab !== 'albums' && outgoingTab !== 'albums'} aria-hidden={tab !== 'albums' || undefined} inert={tab !== 'albums'} tabIndex={tab === 'albums' ? 0 : -1}>
          {albums.length ? <div className="artist-albums">{albums.map((album) => (
            <details className="artist-album" key={album.key} open={view.expandedAlbumKeys.includes(album.key)} onToggle={(event) => {
              const open = event.currentTarget.open;
              if (open === view.expandedAlbumKeys.includes(album.key)) return;
              updateView({ expandedAlbumKeys: open ? [...view.expandedAlbumKeys, album.key] : view.expandedAlbumKeys.filter((key) => key !== album.key) });
            }}>
              <summary><CoverImage src={album.coverUrl} size="md" /><span className="artist-album-copy"><span className="artist-album-title">{album.title}</span><span className="artists-meta">{t('home.songCount', { count: album.songs.length })}</span></span><ChevronRight className="artist-album-chevron" size={17} aria-hidden="true" /></summary>
              <div className="artist-album-content"><p className="artist-album-artist"><ArtistLinks artist={album.artist} fallback={t('common.unknownArtist')} /></p>{songList(album.songs)}</div>
            </details>
          ))}</div> : data.albums.length ? emptyFiltered : <p className="artists-state">{t('artists.noAlbums')}</p>}
        </section>
        </div>
      </>}
      <FavoriteCategoriesDialog open={!!favoriteSong} song={favoriteSong} onCreated={() => {}} onChanged={(favorited) => {
        if (!favoriteSong) return;
        setFavoriteOverrides((previous) => ({ ...previous, [favoriteSong.id]: favorited }));
        void verifyFavorite(favoriteSong.id);
      }} onClose={() => setFavoriteSong(null)} />
    </div>
  );
}

export default function ArtistDetailPage({ name }: { name: string }) {
  const { session } = useAuthSession();
  // Refetch visible membership and user-scoped favorites when identity changes;
  // no previous account's private rows or favorite overrides survive a remount.
  return <ArtistDetailContent key={`${name}\0${session?.user?.email ?? 'guest'}`} name={name} signedIn={!!session?.user} />;
}
