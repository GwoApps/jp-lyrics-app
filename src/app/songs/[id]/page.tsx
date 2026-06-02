'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import type { FuriganaLine } from '@/lib/types';

interface SongData {
  id: string;
  title: string;
  artist: string;
  lyrics_raw: string;
  lyrics_furigana: string;
  created_at: string;
  updated_at: string;
}

interface SpotifyState {
  connected: boolean;
  is_playing: boolean;
  progress_ms: number;
  duration_ms: number;
  track: { name: string; artist: string; album: string } | null;
}

function FuriganaLineView({ line, isActive }: { line: FuriganaLine; isActive: boolean }) {
  if (line.segments.length === 0) {
    return <div className="h-6" />;
  }
  return (
    <div
      className={`leading-[2.8] transition-all duration-300 ${
        isActive ? 'text-white scale-[1.02] origin-left' : 'text-[var(--muted-foreground)] opacity-60'
      }`}
    >
      {line.segments.map((seg, i) => {
        if (!seg.reading) {
          return <span key={i}>{seg.text}</span>;
        }
        return (
          <ruby key={i}>
            {seg.text}
            <rp>(</rp>
            <rt>{seg.reading}</rt>
            <rp>)</rp>
          </ruby>
        );
      })}
    </div>
  );
}

export default function SongViewPage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;
  const [song, setSong] = useState<SongData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRaw, setShowRaw] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [spotify, setSpotify] = useState<SpotifyState | null>(null);
  const [activeLine, setActiveLine] = useState(-1);
  const lyricsRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    if (!id) return;
    fetch(`/api/songs/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error('Not found');
        return r.json();
      })
      .then((data) => {
        setSong(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  // Spotify polling
  const pollSpotify = useCallback(async () => {
    try {
      const res = await fetch('/api/spotify/now-playing');
      const data = await res.json();
      setSpotify(data);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    pollSpotify();
    const interval = setInterval(pollSpotify, 1500);
    return () => clearInterval(interval);
  }, [pollSpotify]);

  // Match track to song and compute active line
  useEffect(() => {
    if (!spotify?.is_playing || !spotify.track || !song) {
      setActiveLine(-1);
      return;
    }

    // Fuzzy match: check if track name or artist contains song title/artist
    const trackLower = `${spotify.track.name} ${spotify.track.artist}`.toLowerCase();
    const songLower = `${song.title} ${song.artist}`.toLowerCase();
    const titleMatch = trackLower.includes(song.title.toLowerCase()) || songLower.includes(spotify.track.name.toLowerCase());

    if (!titleMatch) {
      setActiveLine(-1);
      return;
    }

    // Compute active line from progress
    let furiganaLines: FuriganaLine[] = [];
    try {
      furiganaLines = JSON.parse(song.lyrics_furigana);
    } catch { /* */ }

    const nonEmptyLines = furiganaLines.filter(l => l.segments.length > 0);
    if (nonEmptyLines.length === 0 || !spotify.duration_ms) return;

    const progress = spotify.progress_ms / spotify.duration_ms;
    const lineIndex = Math.floor(progress * nonEmptyLines.length);
    setActiveLine(Math.min(lineIndex, nonEmptyLines.length - 1));
  }, [spotify, song]);

  // Auto-scroll to active line
  useEffect(() => {
    if (activeLine < 0 || !lineRefs.current[activeLine]) return;
    lineRefs.current[activeLine]?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }, [activeLine]);

  const handleDelete = async () => {
    if (!song || !confirm(`「${song.title}」を削除しますか？`)) return;
    const res = await fetch(`/api/songs/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('success', '削除しました');
      setTimeout(() => router.push('/'), 800);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="h-5 w-5 border-2 border-[var(--muted-foreground)]/30 border-t-[var(--muted-foreground)] rounded-full animate-spin" />
      </div>
    );
  }

  if (!song) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <p className="text-sm text-[var(--muted-foreground)]">曲が見つかりません</p>
        <button onClick={() => router.push('/')} className="mt-4 text-xs text-[var(--primary)] hover:underline">一覧に戻る</button>
      </div>
    );
  }

  let furiganaLines: FuriganaLine[] = [];
  try { furiganaLines = JSON.parse(song.lyrics_furigana); } catch { /* */ }

  const isSynced = spotify?.is_playing && spotify.track && activeLine >= 0;

  return (
    <div className="fade-in">
      {/* Breadcrumb */}
      <div className="mb-8 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
        <a href="/" className="hover:text-[var(--foreground)] transition-colors">一覧</a>
        <span className="opacity-40">/</span>
        <span className="text-[var(--foreground)] truncate max-w-[240px]">{song.title}</span>
      </div>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">{song.title}</h1>
            {song.artist && <p className="text-sm text-[var(--muted-foreground)]">{song.artist}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0 pt-1">
            <button onClick={() => setShowRaw(!showRaw)} className="rounded-md px-3 py-1.5 text-xs text-[var(--muted-foreground)] bg-[var(--accent)] hover:text-[var(--foreground)] transition-colors">
              {showRaw ? 'ふりがな表示' : '原文表示'}
            </button>
            <button onClick={() => router.push(`/songs/${id}/edit`)} className="rounded-md px-3 py-1.5 text-xs text-[var(--muted-foreground)] bg-[var(--accent)] hover:text-[var(--foreground)] transition-colors">
              編集
            </button>
            <button onClick={handleDelete} className="rounded-md px-3 py-1.5 text-xs text-[var(--destructive)] bg-red-950/30 hover:bg-red-950/50 transition-colors">
              削除
            </button>
          </div>
        </div>

        {/* Spotify sync indicator */}
        {spotify?.connected && (
          <div className="mt-4 flex items-center gap-2">
            {isSynced ? (
              <div className="flex items-center gap-2 rounded-full bg-green-950/40 border border-green-800/30 px-3 py-1">
                <span className="inline-block h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-xs text-green-400">
                  Spotify同期中 — {spotify.track!.name} / {spotify.track!.artist}
                </span>
              </div>
            ) : spotify.is_playing && spotify.track ? (
              <div className="flex items-center gap-2 rounded-full bg-[var(--accent)] px-3 py-1">
                <span className="inline-block h-2 w-2 rounded-full bg-[var(--muted-foreground)]" />
                <span className="text-xs text-[var(--muted-foreground)]">
                  再生中: {spotify.track.name}（曲が一致しません）
                </span>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Lyrics */}
      <div className="rounded-lg bg-[var(--card)] border border-[var(--border)] overflow-hidden">
        {showRaw ? (
          <pre className="p-6 whitespace-pre-wrap font-sans text-base leading-relaxed max-h-[70vh] overflow-y-auto">
            {song.lyrics_raw || '（歌詞なし）'}
          </pre>
        ) : (
          <div ref={lyricsRef} className="p-6 text-base max-h-[70vh] overflow-y-auto scroll-smooth">
            {furiganaLines.length > 0 ? (
              furiganaLines.map((line, i) => (
                <div key={i} ref={(el) => { lineRefs.current[i] = el; }}>
                  <FuriganaLineView line={line} isActive={i === activeLine && !!isSynced} />
                </div>
              ))
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">歌詞がありません</p>
            )}
          </div>
        )}
      </div>

      {/* Meta */}
      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-6 text-[11px] text-[var(--muted-foreground)]">
          <span>作成: {new Date(song.created_at).toLocaleString('ja-JP')}</span>
          <span>更新: {new Date(song.updated_at).toLocaleString('ja-JP')}</span>
        </div>
        {!spotify?.connected && (
          <a href="/api/auth/login" className="text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
            Spotify連携
          </a>
        )}
      </div>

      {/* Toast */}
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
