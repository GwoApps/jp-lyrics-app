'use client';

import Link from 'next/link';
import { ArrowLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import ArtistLinks from '@/components/ArtistLinks';
import CoverImage from '@/components/CoverImage';
import { useI18n } from '@/lib/i18n';
import type { SongItem } from '@/lib/types';
import { ArtistAvatar } from './ArtistAvatar';
import { profileSourceHref, requestArtistProfile } from './profile-queue';
import type { ArtistProfile } from './types';
import { useArtistResource, validArtistLibrary } from './useArtistResource';
import './artists.css';

function ArtistProfileHeader({ name }: { name: string }) {
  const { t } = useI18n();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ name: string; profile: ArtistProfile | null; failed: boolean } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void requestArtistProfile(name, controller.signal)
      .then((profile) => {
        if (!controller.signal.aborted) setResult({ name, profile, failed: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ name, profile: null, failed: true });
      });
    return () => controller.abort();
  }, [name, attempt]);
  const profile = result?.name === name ? result.profile : null;
  const sourceHref = profileSourceHref(profile?.sourceUrl);

  return (
    <header className="artist-profile">
      <ArtistAvatar name={name} imageUrl={profile?.imageUrl} large />
      <div className="artist-profile-copy">
        <h1>{name}</h1>
        {profile?.description && <p className="artist-description">{profile.description}</p>}
        {!!profile?.genres.length && <ul className="artist-genres" aria-label={t('artists.genres')}>{profile.genres.map((genre) => <li key={genre}>{genre}</li>)}</ul>}
        {sourceHref && <a className="artist-source" href={sourceHref} target="_blank" rel="noopener noreferrer">{t('artists.source', { source: profile?.source || t('artists.profileSource') })}<ExternalLink size={12} aria-hidden="true" /></a>}
        {result?.name === name && result.failed && <div className="artist-profile-retry"><span>{t('artists.profileUnavailable')}</span><button className="artists-text-button" type="button" onClick={() => { setResult(null); setAttempt((value) => value + 1); }}>{t('common.reload')}</button></div>}
      </div>
    </header>
  );
}

function ArtistSongs({ songs }: { songs: SongItem[] }) {
  const { t } = useI18n();
  return <ul className="artist-songs">{songs.map((song) => (
    <li key={song.id} className="artist-song">
      <Link className="artist-song-cover" href={`/songs/${encodeURIComponent(song.id)}`} tabIndex={-1} aria-hidden="true" prefetch={false}><CoverImage src={song.cover_url} size="sm" /></Link>
      <div className="artist-song-copy">
        <Link className="artist-song-title" href={`/songs/${encodeURIComponent(song.id)}`} prefetch={false}>{song.title}</Link>
        <div className="artist-song-artist"><ArtistLinks artist={song.artist} fallback={t('common.unknownArtist')} /></div>
        {song.spotify_album && <span className="artist-song-album">{song.spotify_album}</span>}
      </div>
      <ChevronRight className="artist-song-chevron" size={15} aria-hidden="true" />
    </li>
  ))}</ul>;
}

type LibraryTab = 'songs' | 'albums';
export default function ArtistDetailPage({ name }: { name: string }) {
  const { t } = useI18n();
  const { state, retry } = useArtistResource(`/api/artists/${encodeURIComponent(name)}`, validArtistLibrary);
  const [tab, setTab] = useState<LibraryTab>('songs');
  const tabId = useId();
  const data = state.status === 'ready' ? state.data : null;
  const tabs: LibraryTab[] = ['songs', 'albums'];
  const selectTabWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    let next: LibraryTab | undefined;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') next = tab === 'songs' ? 'albums' : 'songs';
    if (event.key === 'Home') next = 'songs';
    if (event.key === 'End') next = 'albums';
    if (next) {
      event.preventDefault();
      setTab(next);
      document.getElementById(`${tabId}-${next}`)?.focus();
    }
  };

  return (
    <div className="artists-page artist-detail">
      <Link className="artists-back" href="/artists"><ArrowLeft size={14} aria-hidden="true" />{t('artists.back')}</Link>
      <ArtistProfileHeader key={name} name={data?.artist.name ?? name} />
      {state.status === 'loading' && <div className="artists-state" role="status">{t('common.loading')}</div>}
      {state.status === 'error' && <div className="artists-state" role="alert"><p>{t(state.notFound ? 'artists.notFound' : 'artists.detailLoadError')}</p><button type="button" className="artists-button" onClick={retry}>{t('common.reload')}</button></div>}
      {data && <>
        <p className="artist-library-scope">{t('artists.localLibrary')}<span>{t('home.songCount', { count: data.songs.length })}</span><span>{t('home.albumCount', { count: data.albums.length })}</span></p>
        <div className="artist-tabs" role="tablist" aria-label={t('artists.localLibrary')}>
          {tabs.map((value) => <button key={value} id={`${tabId}-${value}`} type="button" role="tab" aria-selected={tab === value} aria-controls={`${tabId}-${value}-panel`} tabIndex={tab === value ? 0 : -1} onKeyDown={selectTabWithKeyboard} onClick={() => setTab(value)}>{t(value === 'songs' ? 'artists.songsTab' : 'artists.albumsTab')}<span>{value === 'songs' ? data.songs.length : data.albums.length}</span></button>)}
        </div>
        <section role="tabpanel" id={`${tabId}-songs-panel`} aria-labelledby={`${tabId}-songs`} hidden={tab !== 'songs'} tabIndex={0}>
          {data.songs.length ? <ArtistSongs songs={data.songs} /> : <p className="artists-state">{t('artists.noSongs')}</p>}
        </section>
        <section role="tabpanel" id={`${tabId}-albums-panel`} aria-labelledby={`${tabId}-albums`} hidden={tab !== 'albums'} tabIndex={0}>
          {data.albums.length ? <div className="artist-albums">{data.albums.map((album) => (
            <details className="artist-album" key={album.key}>
              <summary><CoverImage src={album.coverUrl} size="md" /><span className="artist-album-copy"><span className="artist-album-title">{album.title}</span><span className="artists-meta">{t('home.songCount', { count: album.songs.length })}</span></span><ChevronRight className="artist-album-chevron" size={17} aria-hidden="true" /></summary>
              <div className="artist-album-content"><p className="artist-album-artist"><ArtistLinks artist={album.artist} fallback={t('common.unknownArtist')} /></p><ArtistSongs songs={album.songs} /></div>
            </details>
          ))}</div> : <p className="artists-state">{t('artists.noAlbums')}</p>}
        </section>
      </>}
    </div>
  );
}
