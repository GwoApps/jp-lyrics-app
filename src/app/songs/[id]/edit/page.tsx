'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';

interface SongData {
  id: string;
  title: string;
  artist: string;
  lyrics_raw: string;
}

export default function EditSongPage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    if (!id) return;
    fetch(`/api/songs/${id}`)
      .then((r) => r.json())
      .then((data: SongData) => {
        setTitle(data.title);
        setArtist(data.artist);
        setLyrics(data.lyrics_raw);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  const handleSave = async () => {
    if (!title.trim()) {
      showToast('error', '曲名を入力してください');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/songs/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          artist: artist.trim(),
          lyrics_raw: lyrics,
        }),
      });
      if (!res.ok) throw new Error('保存に失敗しました');
      showToast('success', '保存しました');
      setTimeout(() => router.push(`/songs/${id}`), 800);
    } catch (e: unknown) {
      showToast('error', e instanceof Error ? e.message : 'エラーが発生しました');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 border-2 border-[var(--muted-foreground)]/30 border-t-[var(--muted-foreground)] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="fade-in max-w-2xl mx-auto">
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
        <a href="/" className="hover:text-[var(--foreground)] transition-colors">一覧</a>
        <span>/</span>
        <a href={`/songs/${id}`} className="hover:text-[var(--foreground)] transition-colors truncate max-w-[150px]">
          {title || '曲詳細'}
        </a>
        <span>/</span>
        <span className="text-[var(--foreground)]">編集</span>
      </div>

      <h1 className="text-lg font-semibold tracking-tight mb-6">曲を編集</h1>

      <div className="space-y-4">
        {/* Title */}
        <div>
          <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">
            曲名 <span className="text-[var(--destructive)]">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)] transition-colors"
          />
        </div>

        {/* Artist */}
        <div>
          <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">
            アーティスト
          </label>
          <input
            type="text"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)] transition-colors"
          />
        </div>

        {/* Lyrics */}
        <div>
          <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">
            歌詞
          </label>
          <textarea
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            rows={16}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2.5 text-sm outline-none focus:border-[var(--primary)] transition-colors resize-y leading-relaxed"
          />
          <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
            歌詞を変更すると、ふりがなが再変換されます
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? '変換中...' : '保存'}
          </button>
          <button
            onClick={() => router.push(`/songs/${id}`)}
            className="rounded-md px-4 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            キャンセル
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>{toast.msg}</div>
      )}
    </div>
  );
}
