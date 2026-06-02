'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface SongItem {
  id: string;
  title: string;
  artist: string;
  created_at: string;
  updated_at: string;
}

export default function HomePage() {
  const [songs, setSongs] = useState<SongItem[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/songs')
      .then((r) => r.json())
      .then((data) => {
        setSongs(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`「${title}」を削除しますか？`)) return;
    const res = await fetch(`/api/songs/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setSongs((prev) => prev.filter((s) => s.id !== id));
    }
  };

  return (
    <div className="fade-in">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">曲一覧</h1>
          <p className="text-xs text-[var(--muted-foreground)] mt-1">
            {songs.length} 曲
          </p>
        </div>
        <button
          onClick={() => router.push('/songs/new')}
          className="rounded-md bg-[var(--primary)] px-4 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
        >
          ＋ 新規追加
        </button>
      </div>

      {/* Song list */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-[var(--muted)] animate-pulse" />
          ))}
        </div>
      ) : songs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="text-4xl mb-4 opacity-20">♪</div>
          <p className="text-sm text-[var(--muted-foreground)]">
            まだ曲がありません
          </p>
          <button
            onClick={() => router.push('/songs/new')}
            className="mt-5 rounded-md bg-[var(--accent)] px-4 py-2 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            最初の曲を追加する
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {songs.map((song) => (
            <div
              key={song.id}
              className="group flex items-center gap-4 rounded-lg bg-[var(--card)] border border-[var(--border)] px-5 py-4 transition-colors hover:bg-[var(--muted)] cursor-pointer"
              onClick={() => router.push(`/songs/${song.id}`)}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--muted)] text-sm text-[var(--muted-foreground)]">
                ♪
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{song.title}</div>
                <div className="text-xs text-[var(--muted-foreground)] mt-0.5 truncate">
                  {song.artist || 'アーティスト不明'}
                </div>
              </div>
              <div className="text-[11px] text-[var(--muted-foreground)] hidden sm:block">
                {new Date(song.updated_at).toLocaleDateString('ja-JP')}
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push(`/songs/${song.id}/edit`);
                  }}
                  className="rounded px-2.5 py-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--accent)] transition-colors"
                >
                  編集
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(song.id, song.title);
                  }}
                  className="rounded px-2.5 py-1 text-xs text-[var(--destructive)] hover:bg-red-950/40 transition-colors"
                >
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
