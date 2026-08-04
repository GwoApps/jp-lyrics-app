'use client';

import { useState } from 'react';
import { FolderPlus, Trash, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

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
  onCreate: (name: string) => Promise<void>;
}

/**
 * Collection filter row + management panel for the song list. The panel
 * (create / filter / delete) is collapsible; its open state is local.
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

  const handleCreate = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      await onCreate(name.trim());
      setName('');
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--accent)] transition-colors"
        >
          <FolderPlus className="h-3.5 w-3.5" />
          <span>{t('home.collections')}</span>
        </button>
        {filterCollection && (
          <button
            onClick={() => onFilterChange(null)}
            className="inline-flex items-center gap-1 rounded-full bg-[var(--primary)]/20 text-[var(--primary)] px-2.5 py-1 text-[10px] font-medium"
          >
            {collections.find((c) => c.id === filterCollection)?.name}
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {open && (
        <div className="mb-4 rounded-lg bg-[var(--card)] border border-[var(--border)] p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">{t('home.collectionsTitle')}</span>
            <button onClick={() => setOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
              <X className="h-4 w-4" />
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
              onClick={() => void handleCreate()}
              disabled={!name.trim() || creating}
              className="rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] disabled:opacity-50"
            >
              {t('home.createCollection')}
            </button>
          </div>
          <div className="space-y-1">
            {collections.map((c) => (
              <div
                key={c.id}
                className={`flex items-center justify-between rounded-md px-3 py-2 text-xs cursor-pointer transition-colors ${
                  filterCollection === c.id ? 'bg-[var(--primary)]/10 text-[var(--primary)]' : 'hover:bg-[var(--accent)]'
                }`}
                onClick={() => onFilterChange(filterCollection === c.id ? null : c.id)}
              >
                <span>{c.name} ({c.songCount})</span>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
                  className="text-[var(--muted-foreground)] hover:text-[var(--destructive)]"
                >
                  <Trash className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
