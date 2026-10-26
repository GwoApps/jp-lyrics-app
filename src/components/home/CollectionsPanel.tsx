'use client';

import { useI18n } from '@/lib/i18n';
import { collectionRowLabel } from '@/lib/song-card-a11y';

export interface CollectionInfo {
  id: string;
  name: string;
  songCount: number;
}

// Only a locally-selected filter, never a persisted collection ID.
export const UNCLASSIFIED_COLLECTION_FILTER = 'unclassified';

interface CollectionsPanelProps {
  collections: CollectionInfo[];
  filterCollection: string | null;
  onFilterChange: (id: string | null) => void;
}

/** Visible only while the parent is showing favorites. Category selection is
 * immediate; creation and management belong to the per-song favorite dialog. */
export default function CollectionsPanel({ collections, filterCollection, onFilterChange }: CollectionsPanelProps) {
  const { t } = useI18n();
  const options = [
    { id: UNCLASSIFIED_COLLECTION_FILTER, name: t('home.favoriteUnclassified') },
    ...collections.map((collection) => ({ id: collection.id, name: collection.name })),
  ];
  const buttonClass = (selected: boolean) => `max-w-full min-w-0 shrink-0 truncate rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
    selected ? 'bg-[var(--primary)]/15 text-[var(--primary)]' : 'bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
  }`;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label={t('home.favoriteCategoriesLabel')}>
      <span className="mr-1 text-xs text-[var(--muted-foreground)]">{t('home.collections')}</span>
      <button type="button" aria-pressed={filterCollection === null} onClick={() => onFilterChange(null)}
        className={buttonClass(filterCollection === null)}>{t('home.all')}</button>
      {options.map(({ id, name }) => {
        const selected = filterCollection === id;
        return (
          <button key={id} type="button" aria-pressed={selected}
            aria-label={collectionRowLabel(name, selected, t)}
            onClick={() => onFilterChange(selected ? null : id)} className={buttonClass(selected)}>
            {name}
          </button>
        );
      })}
    </div>
  );
}
