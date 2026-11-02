'use client';

import Link from 'next/link';
import { ExternalLink, Heart, TriangleAlert } from 'lucide-react';
import ArtistLinks from '@/components/ArtistLinks';
import CoverImage from '@/components/CoverImage';
import SpotifyLoginButton from '@/components/SpotifyLoginButton';
import { useI18n } from '@/lib/i18n';
import { formatSongDate, formatSongDuration, formatTranslationLanguage, qualityFields, qualityKinds, qualityState, spotifyTrackHref, type ArtistLibrarySong } from './artist-library-model';

export default function ArtistLibrarySongs({ songs, signedIn, favoriteOverrides, onFavorite, showArtist = true }: {
  songs: ArtistLibrarySong[];
  signedIn: boolean;
  showArtist?: boolean;
  favoriteOverrides: Record<string, boolean | null>;
  onFavorite: (song: ArtistLibrarySong) => void;
}) {
  const { t, locale } = useI18n();
  return <ul className="artist-songs">{songs.map((song) => {
    const duration = formatSongDuration(song.spotify_duration_ms, locale);
    const created = formatSongDate(song.created_at, locale);
    const updated = formatSongDate(song.updated_at, locale);
    const spotify = spotifyTrackHref(song.spotify_track_id);
    const favorited = signedIn ? (Object.hasOwn(favoriteOverrides, song.id) ? favoriteOverrides[song.id] : song.favorited) : null;
    const favoriteLabel = t(favorited === true ? 'artistLibrary.editFavorite' : favorited === false ? 'artistLibrary.addFavorite' : 'artistLibrary.favoriteUnknown');
    return <li key={song.id} className="artist-song artist-library-song">
      <Link className="artist-song-cover" href={`/songs/${encodeURIComponent(song.id)}`} tabIndex={-1} aria-hidden="true" prefetch={false}><CoverImage src={song.cover_url} size="sm" /></Link>
      <div className="artist-song-copy">
        <Link className="artist-song-title" href={`/songs/${encodeURIComponent(song.id)}`} prefetch={false}>{song.title}</Link>
        {showArtist && <div className="artist-song-artist"><ArtistLinks artist={song.artist} fallback={t('common.unknownArtist')} /></div>}
        {song.spotify_album && <span className="artist-song-album">{song.spotify_album}</span>}
        <div className="artist-library-song-meta">
          <span className="artist-library-duration" title={t('artistLibrary.duration')}><span className="sr-only">{duration ? t('artistLibrary.durationValue', { duration }) : t('artistLibrary.durationUnknown')}</span><span aria-hidden="true">{duration ?? '—'}</span></span>
          {created && <span>{t('artistLibrary.createdDate', { date: created })}</span>}
          {updated && <span>{t('artistLibrary.updatedDate', { date: updated })}</span>}
        </div>
        <div className="artist-library-quality">
          {qualityKinds.map((kind) => {
            const status = qualityState(song[qualityFields[kind]]);
            const language = kind === 'translation' && status === 'available' ? formatTranslationLanguage(song.lyrics_translation_lang, locale) ?? t('artistLibrary.translationLanguageUnknown') : null;
            const label = t('artistLibrary.statusLabel', { kind: t(`artistLibrary.${kind}`), status: t(`artistLibrary.${status}`) }) + (language ? ` · ${language}` : '');
            return <span key={kind} className="artist-library-quality-item" data-status={status} title={label}>
              <span className="sr-only">{label}</span><span aria-hidden="true">{t(`artistLibrary.${kind}`)} {status === 'available' ? '✓' : status === 'missing' ? '—' : '?'}{language && ` · ${language}`}</span>
            </span>;
          })}
          {song.lyrics_needs_review === 1 && <span className="artist-library-review"><TriangleAlert size={12} aria-hidden="true" />{t('artistLibrary.needsReview')}</span>}
        </div>
      </div>
      <div className="artist-library-song-actions">
        {signedIn ? <button type="button" className="artist-library-action" onClick={() => onFavorite(song)} aria-pressed={typeof favorited === 'boolean' ? favorited : undefined} title={favoriteLabel} aria-label={favoriteLabel} data-favorite-status={typeof favorited === 'boolean' ? String(favorited) : 'unknown'}>
          <Heart size={17} fill={favorited === true ? 'currentColor' : 'none'} aria-hidden="true" />
        </button> : <SpotifyLoginButton className="artist-library-action" title={t('artistLibrary.loginToFavorite')}><Heart size={17} aria-hidden="true" /><span className="sr-only">{t('artistLibrary.loginToFavorite')}</span></SpotifyLoginButton>}
        {spotify && <a className="artist-library-action" href={spotify} target="_blank" rel="noopener noreferrer" title={t('artistLibrary.openSpotify')} aria-label={t('artistLibrary.openSpotify')}><ExternalLink size={16} aria-hidden="true" /></a>}
      </div>
    </li>;
  })}</ul>;
}
