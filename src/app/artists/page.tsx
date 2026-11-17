import type { Metadata } from 'next';
import ArtistsPage from '@/components/artists/ArtistsPage';

export const metadata: Metadata = {
  title: 'アーティスト',
  description: '歌詞ノートのアーティスト一覧 — 歌手ごとに歌詞を探す。',
};

export default function Page() {
  return <ArtistsPage />;
}
