'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function NewSongPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSave = async () => {
    if (!title.trim()) {
      showToast('error', '曲名を入力してください');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/songs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          artist: artist.trim(),
          lyrics_raw: lyrics,
        }),
      });
      if (!res.ok) throw new Error('保存に失敗しました');
      const song = await res.json();
      showToast('success', '保存しました — ふりがな変換完了');
      setTimeout(() => router.push(`/songs/${song.id}`), 800);
    } catch (e: unknown) {
      showToast('error', e instanceof Error ? e.message : 'エラーが発生しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fade-in max-w-2xl mx-auto">
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
        <a href="/" className="hover:text-[var(--foreground)] transition-colors">一覧</a>
        <span>/</span>
        <span className="text-[var(--foreground)]">新規追加</span>
      </div>

      <h1 className="text-lg font-semibold tracking-tight mb-6">新しい曲を追加</h1>

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
            placeholder="例：残酷な天使のテーゼ"
            className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)] transition-colors placeholder:text-[var(--muted-foreground)]/50"
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
            placeholder="例：高橋洋子"
            className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)] transition-colors placeholder:text-[var(--muted-foreground)]/50"
          />
        </div>

        {/* Lyrics */}
        <div>
          <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">
            歌詞
            <span className="ml-2 font-normal">（漢字を含む日本語歌詞を貼り付け）</span>
          </label>
          <textarea
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            placeholder={`例：\n残酷な天使のように\n少年よ 神話になれ...`}
            rows={16}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2.5 text-sm outline-none focus:border-[var(--primary)] transition-colors placeholder:text-[var(--muted-foreground)]/50 resize-y leading-relaxed"
          />
          <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
            保存時、漢字が自動的にひらがなに変換されます
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? '変換中...' : '保存して表示'}
          </button>
          <button
            onClick={() => router.push('/')}
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
