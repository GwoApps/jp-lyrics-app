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

interface SpotifyStatus {
  connected: boolean;
  display_name?: string;
}

export default function HomePage() {
  const [songs, setSongs] = useState<SongItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [spotify, setSpotify] = useState<SpotifyStatus | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/songs')
      .then((r) => r.json())
      .then((data) => { setSongs(data); setLoading(false); })
      .catch(() => setLoading(false));

    fetch('/api/spotify/status')
      .then((r) => r.json())
      .then((data) => setSpotify(data))
      .catch(() => {});
  }, []);

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`「${title}」を削除しますか？`)) return;
    const res = await fetch(`/api/songs/${id}`, { method: 'DELETE' });
    if (res.ok) setSongs((prev) => prev.filter((s) => s.id !== id));
  };

  const handleDisconnect = async () => {
    await fetch('/api/spotify/status', { method: 'DELETE' });
    setSpotify({ connected: false });
  };

  return (
    <div className="fade-in">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">曲一覧</h1>
          <p className="text-xs text-[var(--muted-foreground)] mt-1">{songs.length} 曲</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Spotify status */}
          {spotify?.connected ? (
            <div className="flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400" />
              <span className="text-xs text-[var(--muted-foreground)]">{spotify.display_name}</span>
              <button onClick={handleDisconnect} className="text-[10px] text-[var(--muted-foreground)] hover:text-[var(--destructive)] transition-colors">
                切断
              </button>
            </div>
          ) : (
            <a href="/api/auth/login" className="flex items-center gap-1.5 rounded-md bg-[#1DB954] px-3 py-2 text-xs font-medium text-black transition-opacity hover:opacity-90">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
              Spotify連携
            </a>
          )}
          <button onClick={() => router.push('/songs/new')} className="rounded-md bg-[var(--primary)] px-4 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90">
            ＋ 新規追加
          </button>
        </div>
      </div>

      {/* Song list */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-16 rounded-lg bg-[var(--muted)] animate-pulse" />)}
        </div>
      ) : songs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="text-4xl mb-4 opacity-20">♪</div>
          <p className="text-sm text-[var(--muted-foreground)]">まだ曲がありません</p>
          <button onClick={() => router.push('/songs/new')} className="mt-5 rounded-md bg-[var(--accent)] px-4 py-2 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
            最初の曲を追加する
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {songs.map((song) => (
            <div key={song.id} className="group flex items-center gap-4 rounded-lg bg-[var(--card)] border border-[var(--border)] px-5 py-4 transition-colors hover:bg-[var(--muted)] cursor-pointer" onClick={() => router.push(`/songs/${song.id}`)}>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--muted)] text-sm text-[var(--muted-foreground)]">♪</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{song.title}</div>
                <div className="text-xs text-[var(--muted-foreground)] mt-0.5 truncate">{song.artist || 'アーティスト不明'}</div>
              </div>
              <div className="text-[11px] text-[var(--muted-foreground)] hidden sm:block">{new Date(song.updated_at).toLocaleDateString('ja-JP')}</div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={(e) => { e.stopPropagation(); router.push(`/songs/${song.id}/edit`); }} className="rounded px-2.5 py-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--accent)] transition-colors">編集</button>
                <button onClick={(e) => { e.stopPropagation(); handleDelete(song.id, song.title); }} className="rounded px-2.5 py-1 text-xs text-[var(--destructive)] hover:bg-red-950/40 transition-colors">削除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
