'use client';

import { useId, useState } from 'react';
import { FolderPlus, Trash, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import ConfirmDialog from '@/components/ConfirmDialog';
import {
  clearCollectionFilterLabel,
  collectionRowLabel,
  deleteCollectionLabel,
} from '@/lib/song-card-a11y';

export interface CollectionInfo {
  id: string;
  name: string;
  songCount: number;
}

interface CollectionsPanelProps {
  collections: CollectionInfo[];
  filterCollection: string | null;
  onFilterChange: (id: string | null) => void;
  onDelete: (id: string) => void;
  onCreate: (name: string) => Promise<boolean>;
}

/**
 * Collection filter row + management panel for the song list. The panel
 * (create / filter / delete) is collapsible; its open state is local.
 *
 * Accessibility (ISSUE #277): the collection rows are listbox options so
 * keyboard and screen-reader users can filter, mirroring the song-card-a11y
 * conventions used elsewhere on the home page. Icon-only controls carry an
 * accessible name, and deleting a collection goes through ConfirmDialog.
 */
export default function CollectionsPanel({
  collections,
  filterCollection,
  onFilterChange,
  onDelete,
  onCreate,
}: CollectionsPanelProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CollectionInfo | null>(null);
  const panelId = useId();
  const listLabelId = useId();

  const handleCreate = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      // onCreate surfaces its own success/error feedback (toast). Only clear the
      // input once the server acknowledged creation, so a failed attempt keeps
      // the typed name for the user to retry.
      const ok = await onCreate(name.trim());
      if (ok) setName('');
    } catch {
      // Guard against any unexpected rejection: the panel must never leave an
      // unhandled Promise rejection, and onCreate already reports the error.
    } finally {
      setCreating(false);
    }
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    onDelete(deleteTarget.id);
    setDeleteTarget(null);
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={t('home.toggleCollectionsLabel')}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--accent)] transition-colors"
        >
          <FolderPlus className="h-3.5 w-3.5" />
          <span>{t('home.collections')}</span>
        </button>
        {filterCollection && (
          <button
            type="button"
            onClick={() => onFilterChange(null)}
            aria-label={clearCollectionFilterLabel(
              collections.find((c) => c.id === filterCollection)?.name ?? '',
              t,
            )}
            className="inline-flex items-center gap-1 rounded-full bg-[var(--primary)]/20 text-[var(--primary)] px-2.5 py-1 text-[10px] font-medium"
          >
            {collections.find((c) => c.id === filterCollection)?.name}
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        )}
      </div>

      {open && (
        <div
          id={panelId}
          className="mb-4 rounded-lg bg-[var(--card)] border border-[var(--border)] p-4"
        >
          <div className="flex items-center justify-between mb-3">
            <span id={listLabelId} className="text-sm font-medium">{t('home.collectionsTitle')}</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('common.close')}
              className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('home.newCollectionPlaceholder')}
              className="flex-1 rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-1.5 text-xs outline-none focus:border-[var(--primary)] transition-colors"
              onKeyDown={(e) => e.key === 'Enter' && void handleCreate()}
            />
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={!name.trim() || creating}
              className="rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] disabled:opacity-50"
            >
              {t('home.createCollection')}
            </button>
          </div>
          {collections.length === 0 ? (
            <p className="rounded-md bg-[var(--muted)] px-3 py-2.5 text-xs text-[var(--muted-foreground)]">
              {t('home.collectionsEmpty')}
            </p>
          ) : (
            <ul className="space-y-1" role="listbox" aria-labelledby={listLabelId}>
              {collections.map((c) => {
                const selected = filterCollection === c.id;
                return (
                  <li key={c.id}>
                    <div
                      className={`flex items-center justify-between rounded-md text-xs transition-colors ${
                        selected ? 'bg-[var(--primary)]/10 text-[var(--primary)]' : 'hover:bg-[var(--accent)]'
                      }`}
                    >
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        aria-label={collectionRowLabel(c.name, selected, t)}
                        onClick={() => onFilterChange(selected ? null : c.id)}
                        className="flex-1 cursor-pointer rounded-md px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--primary)]"
                      >
                        {c.name} ({c.songCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(c)}
                        aria-label={deleteCollectionLabel(c.name, t)}
                        className="px-3 py-2 text-[var(--muted-foreground)] hover:text-[var(--destructive)]"
                      >
                        <Trash className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
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
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
