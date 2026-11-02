'use client';

import { useI18n } from '@/lib/i18n';
import { defaultLibraryView, qualityKinds, type LibraryView, type QualityFilter } from './artist-library-model';

export default function ArtistLibraryControls({ view, onChange }: { view: LibraryView; onChange: (change: Partial<LibraryView>) => void }) {
  const { t } = useI18n();
  return <form className="artist-library-controls" role="search" aria-label={t('artistLibrary.searchLabel')} onSubmit={(event) => event.preventDefault()}>
    <label className="artist-library-query"><span>{t('artistLibrary.searchLabel')}</span><input type="search" value={view.query} placeholder={t('artistLibrary.searchPlaceholder')} onChange={(event) => onChange({ query: event.target.value })} /></label>
    <div className="artist-library-selects">
      <label><span>{t('artistLibrary.sort')}</span><select aria-label={t('artistLibrary.sort')} value={view.sort} onChange={(event) => onChange({ sort: event.target.value as LibraryView['sort'] })}>
        <option value="name">{t('artistLibrary.sortName')}</option><option value="created">{t('artistLibrary.sortCreated')}</option><option value="updated">{t('artistLibrary.sortUpdated')}</option>
      </select></label>
      <label><span>{t('artistLibrary.credit')}</span><select aria-label={t('artistLibrary.credit')} value={view.credit} onChange={(event) => onChange({ credit: event.target.value as LibraryView['credit'] })}>
        <option value="all">{t('artistLibrary.all')}</option><option value="solo">{t('artistLibrary.solo')}</option><option value="collab">{t('artistLibrary.collab')}</option>
      </select></label>
      <label><span>{t('artistLibrary.review')}</span><select aria-label={t('artistLibrary.review')} value={view.review} onChange={(event) => onChange({ review: event.target.value as LibraryView['review'] })}>
        <option value="all">{t('artistLibrary.all')}</option><option value="needsReview">{t('artistLibrary.needsReview')}</option>
      </select></label>
      {qualityKinds.map((kind) => <label key={kind}><span>{t(`artistLibrary.${kind}`)}</span><select aria-label={t(`artistLibrary.${kind}`)} value={view[kind]} onChange={(event) => onChange({ [kind]: event.target.value as QualityFilter })}>
        {(['all', 'available', 'missing', 'unknown'] as const).map((status) => <option key={status} value={status}>{t(`artistLibrary.${status}`)}</option>)}
      </select></label>)}
    </div>
    <button type="button" className="artists-text-button artist-library-reset" onClick={() => onChange({ ...defaultLibraryView(), tab: view.tab, expandedAlbumKeys: view.expandedAlbumKeys })}>{t('artistLibrary.reset')}</button>
  </form>;
}
