'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { ExternalLink, Pencil } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useAuthSession } from '@/lib/auth-session';
import { ArtistAvatar } from './ArtistAvatar';
import ArtistProfileEditor from './ArtistProfileEditor';
import { getCachedArtistProfile } from './artist-profile-cache';
import { requestArtistProfile } from './profile-queue';
import { resolveArtistDescription, safeArtistExternalHref } from './profile-presentation';
import type { ArtistProfile } from './types';
import './artist-profile.css';

export default function ArtistProfileHeader({ name }: { name: string }) {
  const { t, locale } = useI18n();
  const { session } = useAuthSession();
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const descriptionId = useId();
  const [result, setResult] = useState<{ name: string; profile: ArtistProfile | null; failed: boolean } | null>(() => {
    const profile = getCachedArtistProfile(name);
    return profile ? { name, profile, failed: false } : null;
  });
  useEffect(() => {
    const controller = new AbortController();
    void requestArtistProfile(name, controller.signal)
      .then((profile) => { if (!controller.signal.aborted) setResult({ name, profile, failed: false }); })
      .catch(() => {
        if (!controller.signal.aborted) setResult((previous) => ({ name, profile: previous?.name === name ? previous.profile : null, failed: true }));
      });
    return () => controller.abort();
  }, [name, attempt]);
  const refresh = useCallback(() => { setAttempt((value) => value + 1); }, []);
  const profile = result?.name === name ? result.profile : getCachedArtistProfile(name);
  const description = resolveArtistDescription(profile ?? {}, locale);
  const expandable = description.text.length > 160 || description.text.split('\n').length > 3;
  const aliases = profile?.aliases?.filter((alias) => alias.trim().toLowerCase() !== name.trim().toLowerCase()) ?? [];
  let country = profile?.country ?? '';
  if (country) {
    try { country = new Intl.DisplayNames([locale], { type: 'region' }).of(country) ?? country; } catch { /* Retain source's region code if Intl cannot resolve it. */ }
  }
  const kindKey = profile?.kind === 'person' ? 'kindPerson' : profile?.kind === 'group' ? 'kindGroup' : profile?.kind === 'other' ? 'kindOther' : null;
  const links = { ...profile?.links };
  if (!links.spotify && profile?.source === 'Spotify' && profile.sourceUrl) links.spotify = profile.sourceUrl;
  const sources = profile?.sources?.length ? profile.sources : profile?.source ? [{ label: profile.source, url: profile.sourceUrl, fields: ['imageUrl', ...(profile.genres.length ? ['genres'] : [])] }] : [];
  const fields: Record<string, string> = { imageUrl: 'portrait', description: 'biography', descriptions: 'biography', aliases: 'aliases', kind: 'kind', country: 'country', genres: 'genres', links: 'externalLinks', bindings: 'identityBindings', spotifyArtistId: 'identityBindings', musicbrainzId: 'identityBindings', wikidataId: 'identityBindings' };
  const date = profile?.updatedAt ? new Date(profile.updatedAt) : null;

  return (
    <header className="artist-profile">
      <ArtistAvatar name={name} imageUrl={profile?.imageUrl} large />
      <div className="artist-profile-copy">
        <div className="artist-profile-title"><h1>{name}</h1>{session?.user?.isAdmin && <button type="button" className="artist-profile-edit" onClick={() => setEditing(true)}><Pencil size={13} aria-hidden="true" />{t('artistProfile.edit')}</button>}</div>
        {aliases.length > 0 && <p className="artist-profile-aliases"><span>{t('artistProfile.aliases')}</span>{aliases.join(' / ')}</p>}
        {(kindKey || country) && <p className="artist-profile-facts">{kindKey && <span>{t(`artistProfile.${kindKey}`)}</span>}{country && <span>{country}</span>}</p>}
        {description.text && <div className="artist-profile-biography">
          <p id={descriptionId} lang={description.language ?? undefined} className={`artist-description${expandable && !expanded ? ' artist-description--collapsed' : ''}`}>{description.text}</p>
          {expandable && <button type="button" className="artists-text-button" aria-expanded={expanded} aria-controls={descriptionId} onClick={() => setExpanded((value) => !value)}>{t(expanded ? 'artistProfile.less' : 'artistProfile.more')}</button>}
        </div>}
        {!!profile?.genres.length && <ul className="artist-genres" aria-label={t('artists.genres')}>{profile.genres.map((genre) => <li key={genre}>{genre}</li>)}</ul>}
        {Object.keys(links).length > 0 && <div className="artist-profile-links">{(['website', 'spotify', 'youtube', 'musicbrainz', 'wikidata'] as const).map((key) => {
          const href = safeArtistExternalHref(links[key]);
          return href ? <a key={key} className="artist-profile-link" href={href} target="_blank" rel="noopener noreferrer">{key === 'website' ? t('artistProfile.website') : key === 'spotify' ? 'Spotify' : key === 'youtube' ? 'YouTube' : key === 'musicbrainz' ? 'MusicBrainz' : 'Wikidata'}<ExternalLink size={11} aria-hidden="true" /></a> : null;
        })}</div>}
        {sources.length > 0 && <details className="artist-profile-sources"><summary>{t('artistProfile.sources')}</summary><ul>{sources.map((source, index) => {
          const href = safeArtistExternalHref(source.url);
          const label = source.label === 'Manual' ? t('artistProfile.manual') : source.label;
          const names = [...new Set(source.fields.map((field) => fields[field] ?? fields[field.split('.')[0]]).filter(Boolean))].map((key) => t(`artistProfile.${key}`));
          return <li key={`${source.label}-${index}`}>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{label}<ExternalLink size={10} aria-hidden="true" /></a> : <span>{label}</span>}{names.length > 0 && <span> · {names.join(' / ')}</span>}</li>;
        })}</ul>{date && Number.isFinite(date.getTime()) && <p>{t('artistProfile.updatedAt', { date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date) })}</p>}</details>}
        {result?.name === name && result.failed && <div className="artist-profile-retry"><span>{t('artists.profileUnavailable')}</span><button className="artists-text-button" type="button" onClick={refresh}>{t('common.reload')}</button></div>}
      </div>
      {session?.user?.isAdmin && <ArtistProfileEditor open={editing} name={name} profile={profile} onClose={() => setEditing(false)} onSaved={refresh} />}
    </header>
  );
}
