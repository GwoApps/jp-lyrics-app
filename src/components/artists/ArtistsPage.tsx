'use client';

import { Link } from '@/components/navigation/ViewTransitions';
import { Search, UsersRound, X } from 'lucide-react';
import { useState } from 'react';
import { artistHref } from '@/lib/artists';
import { useI18n } from '@/lib/i18n';
import LazyArtistAvatar from './ArtistAvatar';
import { useArtistResource, validArtistList } from './useArtistResource';
import './artists.css';

export default function ArtistsPage() {
  const { t } = useI18n();
  const { state, retry } = useArtistResource('/api/artists', validArtistList);
  const [query, setQuery] = useState('');
  const search = query.normalize('NFKC').trim().toLocaleLowerCase();
  const artists = state.status === 'ready' ? state.data.artists : [];
  const filtered = artists.filter((artist) => artist.name.normalize('NFKC').toLocaleLowerCase().includes(search));

  return (
    <div className="artists-page" data-artist-directory-state={state.status}>
      <header className="artists-heading">
        <h1>{t('artists.title')}</h1>
        {state.status === 'ready' && <span className="artists-meta">{t('artists.artistCount', { count: filtered.length })}</span>}
      </header>
      <div className="artists-search">
        <Search size={15} aria-hidden="true" />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t('artists.search')} placeholder={t('artists.search')} />
        {query && <button type="button" onClick={() => setQuery('')} aria-label={t('common.clear')}><X size={15} aria-hidden="true" /></button>}
      </div>
      {state.status === 'loading' && (
        <div role="status" className="artists-state">
          <p>{t('common.loading')}</p>
          <div className="artists-grid" aria-hidden="true">{Array.from({ length: 8 }, (_, index) => <div className="artist-skeleton" key={index}><span className="artist-avatar" /><span /></div>)}</div>
        </div>
      )}
      {state.status === 'error' && <div className="artists-state" role="alert"><p>{t('artists.loadError')}</p><button className="artists-button" type="button" onClick={retry}>{t('common.reload')}</button></div>}
      {state.status === 'ready' && (filtered.length > 0 ? (
        <ul className="artists-grid" aria-label={t('artists.title')}>
          {filtered.map((artist) => (
            <li key={artist.name}>
              <Link href={artistHref(artist.name)} className="artist-card" prefetch={false}>
                <LazyArtistAvatar name={artist.name} />
                <span className="artist-card-name">{artist.name}</span>
                <span className="artist-card-counts"><span>{t('home.songCount', { count: artist.songCount })}</span><span>{t('home.albumCount', { count: artist.albumCount })}</span></span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="artists-state" role="status">
          <UsersRound size={28} aria-hidden="true" />
          <p>{t(search ? 'artists.noMatches' : 'artists.empty')}</p>
          <button type="button" className="artists-button" onClick={search ? () => setQuery('') : retry}>{t(search ? 'common.clear' : 'common.reload')}</button>
        </div>
      ))}
    </div>
  );
}
