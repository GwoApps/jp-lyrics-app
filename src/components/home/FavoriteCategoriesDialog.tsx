'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import Dialog from '@/components/ui/dialog';
import type { CollectionInfo } from '@/components/home/CollectionsPanel';

export interface FavoriteCategories {
  favorited: boolean;
  inUnclassified: boolean;
  collectionIds: string[];
}

interface Props {
  open?: boolean;
  song: { id: string; title: string } | null;
  onCreated: (collection: CollectionInfo) => void;
  onChanged: (favorited: boolean, categories: FavoriteCategories) => void;
  onClose: () => void;
}

export default function FavoriteCategoriesDialog({ open = true, song, onCreated, onChanged, onClose }: Props) {
  const { t } = useI18n();
  const [categories, setCategories] = useState<FavoriteCategories | null>(null);
  const [availableCollections, setAvailableCollections] = useState<CollectionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [draftCollections, setDraftCollections] = useState<CollectionInfo[]>([]);
  const [newName, setNewName] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const requestInFlight = useRef(false);
  const songId = song?.id;
  const [previousSession, setPreviousSession] = useState({ open, songId });

  // The component stays mounted for exit motion. Reset before rendering each new
  // open session, including a quick reopen before the previous exit has finished.
  if (previousSession.open !== open || previousSession.songId !== songId) {
    setPreviousSession({ open, songId });
    if (open) {
      setCategories(null);
      setAvailableCollections(null);
      setError(null);
      setBusy(false);
      setShowCreate(false);
      setDraftCollections([]);
      setNewName('');
    }
  }

  const close = useCallback(() => {
    if (!requestInFlight.current) onClose();
  }, [onClose]);
  useEffect(() => {
    if (!open || !songId) return;
    let active = true;
    Promise.all([
      fetch(`/api/songs/${encodeURIComponent(songId)}/favorite`),
      fetch('/api/collections'),
    ]).then(async ([favoriteResponse, collectionsResponse]) => {
      if (!favoriteResponse.ok || !collectionsResponse.ok) throw new Error();
      const [data, list] = await Promise.all([
        favoriteResponse.json() as Promise<FavoriteCategories>,
        collectionsResponse.json() as Promise<CollectionInfo[]>,
      ]);
      if (typeof data.favorited !== 'boolean' || typeof data.inUnclassified !== 'boolean'
        || !Array.isArray(data.collectionIds) || !Array.isArray(list)) throw new Error();
      if (active) {
        setCategories(data);
        setAvailableCollections(list);
      }
    }).catch(() => { if (active) setError(t('home.favoriteLoadFailed')); });
    return () => { active = false; };
  }, [open, songId, t]);

  const create = () => {
    const name = newName.trim();
    if (!name || busy || !availableCollections) return;
    // Only stage the new category. Cancel discards it together with checkbox edits;
    // Save creates it atomically with the song memberships.
    const collection = { id: `draft:${crypto.randomUUID()}`, name, songCount: 0 };
    setDraftCollections((prev) => [...prev, collection]);
    setCategories((prev) => prev && ({ ...prev, collectionIds: [...prev.collectionIds, collection.id] }));
    setNewName('');
    setShowCreate(false);
    setError(null);
  };

  const save = async (remove = false) => {
    if (!song || !categories || !availableCollections || busy) return;
    if (!remove && !categories.inUnclassified && categories.collectionIds.length === 0) {
      setError(t('home.favoriteSelectionRequired'));
      return;
    }
    requestInFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/songs/${encodeURIComponent(song.id)}/favorite`, {
        method: remove ? 'DELETE' : 'PUT',
        ...(remove ? {} : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inUnclassified: categories.inUnclassified,
            collectionIds: categories.collectionIds.filter((id) => !id.startsWith('draft:')),
            newCollections: draftCollections.filter((item) => categories.collectionIds.includes(item.id)).map((item) => item.name),
          }),
        }),
      });
      if (!response.ok) throw new Error();
      if (!remove) {
        const saved = await response.json() as FavoriteCategories & { createdCollections: CollectionInfo[] };
        saved.createdCollections.forEach(onCreated);
        onChanged(true, saved);
      } else onChanged(false, { favorited: false, inUnclassified: false, collectionIds: [] });
      onClose();
    } catch {
      setError(t(remove ? 'home.favoriteRemoveFailed' : 'home.favoriteSaveFailed'));
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  };

  const changeCollection = (id: string) => {
    setError(null);
    setCategories((prev) => prev && ({ ...prev, collectionIds: prev.collectionIds.includes(id)
      ? prev.collectionIds.filter((item) => item !== id)
      : [...prev.collectionIds, id] }));
  };

  return (
    <Dialog open={open && !!song} onClose={close} dismissible={!busy}
      initialFocusRef={cancelRef} title={t('home.favoriteCategoriesTitle', { title: song?.title ?? '' })}
      data-favorite-dialog="" className="max-w-[420px] max-h-[min(80vh,640px)] flex flex-col rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] p-5">
        <h2 className="text-left text-base font-semibold mb-4">{t('home.favoriteCategoriesTitle', { title: song?.title ?? '' })}</h2>
        <div className="min-h-0 overflow-y-auto flex-1 space-y-0.5" role="group" aria-label={t('home.favoriteCategoriesLabel')}>
          <button type="button" onClick={() => setShowCreate(true)} disabled={busy || !categories || !availableCollections}
            className="w-full text-left flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-[var(--primary)] hover:bg-[var(--accent)] transition-colors disabled:opacity-50">
            <Plus className="size-4" aria-hidden="true" />{t('home.favoriteCreateCategory')}
          </button>
          {showCreate && (
            <form className="flex gap-2 p-2" onSubmit={(event) => { event.preventDefault(); create(); }}>
              <input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)}
                maxLength={100} aria-label={t('home.newCollectionPlaceholder')} placeholder={t('home.newCollectionPlaceholder')}
                className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm focus-visible:outline-[var(--primary)]" />
              <button type="submit" disabled={!newName.trim() || busy} className="rounded-md bg-[var(--primary)] px-2 text-sm text-[var(--primary-foreground)] disabled:opacity-50">{t('home.createCollection')}</button>
            </form>
          )}
          {categories && (
            <div role="group" aria-label={t('home.favoriteCategoriesLabel')} className="flex flex-col gap-0.5">
              <label className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors ${categories.inUnclassified ? 'bg-[var(--primary)]/15' : 'hover:bg-[var(--accent)]'}`}>
                <input type="checkbox" checked={categories.inUnclassified} disabled={busy}
                  onChange={(event) => { setError(null); setCategories((prev) => prev && ({ ...prev, inUnclassified: event.target.checked })); }}
                  className="size-4 accent-[var(--primary)]" />{t('home.favoriteUnclassified')}
              </label>
              {[...(availableCollections ?? []), ...draftCollections].map((collection) => {
                const selected = categories.collectionIds.includes(collection.id);
                return <label key={collection.id} className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors ${selected ? 'bg-[var(--primary)]/15' : 'hover:bg-[var(--accent)]'}`}>
                  <input type="checkbox" checked={selected} disabled={busy} onChange={() => changeCollection(collection.id)}
                    className="size-4 accent-[var(--primary)]" /><span className="truncate">{collection.name}</span>
                </label>;
              })}
            </div>
          )}
          {!availableCollections && !error && <div role="status" className="flex items-center gap-2 p-3 text-sm"><Loader2 className="size-4 animate-spin" />{t('common.loading')}</div>}
        </div>
        {error && <p role="alert" className="mt-3 text-xs text-[var(--destructive)]">{error}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] pt-4 mt-4">
          <button ref={cancelRef} type="button" onClick={close} disabled={busy}
            className="rounded-md px-3 py-2 text-sm hover:bg-[var(--accent)] disabled:opacity-50">{t('common.cancel')}</button>
          <button type="button" onClick={() => void save(true)} disabled={busy || !categories?.favorited || !availableCollections}
            className="rounded-md px-3 py-2 text-sm text-[var(--destructive)] hover:bg-[var(--destructive)]/10 disabled:opacity-50">{t('home.favoriteRemove')}</button>
          <button type="button" onClick={() => void save()} disabled={busy || !categories || !availableCollections}
            className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50">{t('common.save')}</button>
        </div>
    </Dialog>
  );
}
