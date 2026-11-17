import type { Metadata } from 'next';
import SongLibraryPage from '@/components/home/SongLibraryPage';

export const metadata: Metadata = {
  title: 'アルバム',
  description: '歌詞ノートのアルバム一覧 — 曲名・歌手で整理した歌詞ライブラリ。',
};

export default function AlbumsPage() {
  return <SongLibraryPage key="albums" listKind="albums" />;
}
