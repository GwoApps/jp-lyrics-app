'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Music, Pencil, Trash2, Plus, Unlink, Download, ExternalLink, Loader2 } from 'lucide-react';

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

interface NowPlaying {
  connected: boolean;
  is_playing: boolean;
  track: { name: string; artist: string; album: string } | null;
  progress_ms: number;
  duration_ms: number;
}

function normalize(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

function fuzzyMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  // Bigram (Sørensen-Dice) similarity — much better than char overlap
  const bg = (s: string) => { const set = new Set<string>(); for (let i = 0; i < s.length - 1; i++) set.add(s.substring(i, i + 2)); return set; };
  const aSet = bg(na), bSet = bg(nb);
  let common = 0; for (const g of aSet) { if (bSet.has(g)) common++; }
  return (2 * common) / (aSet.size + bSet.size) >= 0.4;
}

export default function HomePage() {
  const [songs, setSongs] = useState<SongItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [spotify, setSpotify] = useState<SpotifyStatus | null>(null);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const router = useRouter();

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  };

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

  const pollNowPlaying = useCallback(async () => {
    try {
      const res = await fetch('/api/spotify/now-playing');
      const data = await res.json();
      setNowPlaying(data);
    } catch { /* */ }
  }, []);

  useEffect(() => {
    pollNowPlaying();
    const interval = setInterval(pollNowPlaying, 3000);
    return () => clearInterval(interval);
  }, [pollNowPlaying]);

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`「${title}」を削除しますか？`)) return;
    const res = await fetch(`/api/songs/${id}`, { method: 'DELETE' });
    if (res.ok) setSongs((prev) => prev.filter((s) => s.id !== id));
  };

  const handleDisconnect = async () => {
    await fetch('/api/spotify/status', { method: 'DELETE' });
    setSpotify({ connected: false });
    setNowPlaying(null);
  };

  const handleImport = async () => {
    if (!nowPlaying?.track) return;
    setImporting(true);
    try {
      const res = await fetch('/api/songs/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: nowPlaying.track.name, artist: nowPlaying.track.artist }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        showToast('error', data.error || '歌詞の取得に失敗しました');
        return;
      }
      router.push(`/songs/${data.id}`);
    } catch {
      showToast('error', '取込に失敗しました');
    } finally {
      setImporting(false);
    }
  };

  // Find matching song in DB for currently playing track
  const matchedSong = nowPlaying?.track
    ? songs.find((s) => fuzzyMatch(s.title, nowPlaying.track!.name))
    : null;

  return (
    <div className="fade-in">
      {/* Header */}
      <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">曲一覧</h1>
          <p className="text-xs text-[var(--muted-foreground)] mt-1">{songs.length} 曲</p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
          {spotify?.connected ? (
            <div className="flex items-center gap-2 flex-1 sm:flex-none">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400" />
              <span className="text-xs text-[var(--muted-foreground)] truncate">{spotify.display_name}</span>
              <button onClick={handleDisconnect} className="text-[var(--muted-foreground)] hover:text-[var(--destructive)] transition-colors" title="切断">
                <Unlink className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <a href="/api/auth/login" className="inline-flex items-center gap-1.5 rounded-md bg-[#1DB954] px-3 py-2 text-xs font-medium text-black transition-opacity hover:opacity-90 flex-1 sm:flex-none justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" /></svg>
              <span>Spotify</span>
            </a>
          )}
          <button onClick={() => router.push('/songs/new')} className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-3 sm:px-4 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90">
            <Plus className="h-3.5 w-3.5" />
            <span>新規</span>
          </button>
        </div>
      </div>

      {/* Now Playing bar */}
      {nowPlaying?.is_playing && nowPlaying.track && (
        <div className="mb-5 sm:mb-6 rounded-lg bg-[var(--card)] border border-[var(--border)] p-3 sm:p-4 flex items-center gap-3">
          <div className="relative shrink-0">
            <Music className="h-5 w-5 text-green-400" />
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-400 animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{nowPlaying.track.name}</div>
            <div className="text-xs text-[var(--muted-foreground)] truncate">{nowPlaying.track.artist}</div>
          </div>
          {matchedSong ? (
            <button
              onClick={() => router.push(`/songs/${matchedSong.id}`)}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-[var(--muted-foreground)] bg-[var(--accent)] hover:text-[var(--foreground)] transition-colors shrink-0"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">表示</span>
            </button>
          ) : (
            <button
              onClick={handleImport}
              disabled={importing}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-[var(--primary)] text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50 shrink-0"
            >
              {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              <span>{importing ? '取得中...' : '取込'}</span>
            </button>
          )}
        </div>
      )}

      {/* Song list */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-16 rounded-lg bg-[var(--muted)] animate-pulse" />)}
        </div>
      ) : songs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Music className="h-10 w-10 mb-4 text-[var(--muted-foreground)] opacity-20" />
          <p className="text-sm text-[var(--muted-foreground)]">まだ曲がありません</p>
          <button onClick={() => router.push('/songs/new')} className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-2 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
            <Plus className="h-3.5 w-3.5" /> 最初の曲を追加する
          </button>
        </div>
      ) : (
        <div className="space-y-1.5 sm:space-y-2">
          {songs.map((song) => {
            const isPlaying = nowPlaying?.is_playing && nowPlaying.track && fuzzyMatch(song.title, nowPlaying.track.name);
            return (
              <div key={song.id} className={`group flex items-center gap-3 sm:gap-4 rounded-lg bg-[var(--card)] border px-4 sm:px-5 py-3 sm:py-4 transition-colors hover:bg-[var(--muted)] cursor-pointer ${isPlaying ? 'border-green-800/50 bg-green-950/10' : 'border-[var(--border)]'}`} onClick={() => router.push(`/songs/${song.id}`)}>
                <div className={`flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-md ${isPlaying ? 'bg-green-950/30' : 'bg-[var(--muted)]'}`}>
                  <Music className={`h-4 w-4 ${isPlaying ? 'text-green-400' : 'text-[var(--muted-foreground)]'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate flex items-center gap-2">
                    {song.title}
                    {isPlaying && <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />}
                  </div>
                  <div className="text-xs text-[var(--muted-foreground)] mt-0.5 truncate">{song.artist || 'アーティスト不明'}</div>
                </div>
                <div className="text-[10px] sm:text-[11px] text-[var(--muted-foreground)] hidden sm:block shrink-0">{new Date(song.updated_at).toLocaleDateString('ja-JP')}</div>
                <div className="flex items-center gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0">
                  <button onClick={(e) => { e.stopPropagation(); router.push(`/songs/${song.id}/edit`); }} className="rounded p-1.5 sm:p-2 text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--accent)] transition-colors">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(song.id, song.title); }} className="rounded p-1.5 sm:p-2 text-[var(--destructive)] hover:bg-red-950/40 transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
