'use client';

import { useId, useState } from 'react';
import { Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import ConfirmDialog from '@/components/ConfirmDialog';
import { collectionRowLabel, deleteCollectionLabel, renameCollectionLabel } from '@/lib/song-card-a11y';

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
  /** Resolve to true once the server acknowledged creation; the caller toasts. */
  onCreate: (name: string) => Promise<boolean>;
  onRename: (id: string, name: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}

/**
 * Favorite-category chips plus a collapsed management panel (create / rename /
 * delete). Chips are the everyday filter; management stays behind one toggle so
 * the row does not grow icon buttons per category.
 *
 * #392: the chips alone left `POST`/`PUT`/`DELETE /api/collections*` with no
 * caller — creating a category required catching a 3-second toast, and renaming
 * or deleting was impossible from the UI at all.
 */
export default function CollectionsPanel({
  collections, filterCollection, onFilterChange, onCreate, onRename, onDelete,
}: CollectionsPanelProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [renameTarget, setRenameTarget] = useState<CollectionInfo | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CollectionInfo | null>(null);
  const panelId = useId();
  const listLabelId = useId();

  const options = [
    { id: UNCLASSIFIED_COLLECTION_FILTER, name: t('home.favoriteUnclassified') },
    ...collections.map((collection) => ({ id: collection.id, name: collection.name })),
  ];
  const buttonClass = (selected: boolean) => `max-w-full min-w-0 shrink-0 truncate rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
    selected ? 'bg-[var(--primary)]/15 text-[var(--primary)]' : 'bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
  }`;

  // Only clear the input once the server acknowledged creation, so a failed
  // attempt keeps the typed name for a retry.
  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      if (await onCreate(name)) setNewName('');
    } catch {
      // onCreate reports its own failure; never leave an unhandled rejection.
    } finally {
      setCreating(false);
    }
  };

  const startRename = (collection: CollectionInfo) => {
    setDeleteTarget(null);
    setRenameTarget(collection);
    setRenameDraft(collection.name);
  };

  const submitRename = async () => {
    const name = renameDraft.trim();
    if (!renameTarget || !name || renaming) return;
    if (name === renameTarget.name) { setRenameTarget(null); return; }
    setRenaming(true);
    try {
      if (await onRename(renameTarget.id, name)) setRenameTarget(null);
    } catch {
      // Toast already shown by the caller; keep the input open for a retry.
    } finally {
      setRenaming(false);
    }
  };

  const confirmDelete = async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    try {
      await onDelete(target.id);
    } catch {
      // Toast already shown by the caller.
    }
  };

  return (
    <>
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
        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls={panelId}
          aria-label={t('home.toggleCollectionsLabel')} title={t('home.toggleCollectionsLabel')}
          className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
            open ? 'bg-[var(--primary)]/15 text-[var(--primary)]' : 'text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]'
          }`}>
          <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {open && (
        <div id={panelId} className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <p id={listLabelId} className="mb-3 text-sm font-medium">{t('home.collectionsTitle')}</p>
          <form className="mb-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); void handleCreate(); }}>
            <input type="text" value={newName} onChange={(event) => setNewName(event.target.value)}
              maxLength={100} aria-label={t('home.newCollectionPlaceholder')} placeholder={t('home.newCollectionPlaceholder')}
              className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-1.5 text-xs focus-visible:outline-[var(--primary)]" />
            <button type="submit" disabled={!newName.trim() || creating}
              className="inline-flex items-center gap-1 rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] disabled:opacity-50">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />{t('home.createCollection')}
            </button>
          </form>
          {collections.length === 0 ? (
            <p className="rounded-md bg-[var(--muted)] px-3 py-2.5 text-xs text-[var(--muted-foreground)]">{t('home.collectionsEmpty')}</p>
          ) : (
            <ul className="space-y-1" aria-labelledby={listLabelId}>
              {collections.map((collection) => {
                const selected = filterCollection === collection.id;
                const renamingThis = renameTarget?.id === collection.id;
                return (
                  <li key={collection.id} className="flex items-center gap-1 rounded-md text-xs transition-colors hover:bg-[var(--accent)]">
                    {renamingThis ? (
                      <form className="flex min-w-0 flex-1 gap-1 p-1" onSubmit={(event) => { event.preventDefault(); void submitRename(); }}>
                        <input autoFocus value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)}
                          maxLength={100} aria-label={t('home.collectionNameLabel')}
                          className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-xs focus-visible:outline-[var(--primary)]" />
                        <button type="submit" disabled={!renameDraft.trim() || renaming}
                          className="rounded-md bg-[var(--primary)] px-2 py-1 text-xs font-medium text-[var(--primary-foreground)] disabled:opacity-50">{t('common.save')}</button>
                        <button type="button" onClick={() => setRenameTarget(null)}
                          className="rounded-md px-2 py-1 text-xs hover:bg-[var(--muted)]">{t('common.cancel')}</button>
                      </form>
                    ) : (
                      <>
                        <button type="button" aria-pressed={selected} aria-label={collectionRowLabel(collection.name, selected, t)}
                          onClick={() => onFilterChange(selected ? null : collection.id)}
                          className={`min-w-0 flex-1 truncate rounded-md px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--primary)] ${selected ? 'text-[var(--primary)]' : ''}`}>
                          {collection.name} ({collection.songCount})
                        </button>
                        <button type="button" onClick={() => startRename(collection)}
                          aria-label={renameCollectionLabel(collection.name, t)}
                          className="rounded-md p-2 text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button type="button" onClick={() => setDeleteTarget(collection)}
                          aria-label={deleteCollectionLabel(collection.name, t)}
                          className="rounded-md p-2 text-[var(--muted-foreground)] hover:text-[var(--destructive)]">
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('home.deleteCollectionConfirmTitle', { name: deleteTarget?.name ?? '' })}
        body={t('home.deleteCollectionConfirmBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        variant="danger"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
