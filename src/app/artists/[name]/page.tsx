import type { Metadata } from 'next';
import ArtistDetailPage from '@/components/artists/ArtistDetailPage';

export async function generateMetadata(
  { params }: { params: Promise<{ name: string }> },
): Promise<Metadata> {
  const { name: segment } = await params;
  const name = decodeURIComponent(segment).trim();
  return {
    ...(name ? { title: name } : {}),
    description: `${name} の歌詞・アルバム一覧 — 歌詞ノート。`,
  };
}

export default async function Page({ params }: { params: Promise<{ name: string }> }) {
  const { name: segment } = await params;
  // App-page params retain the encoded segment in our Next.js runtime (API-route
  // params do not). Decode exactly once here, preserving literal %20 in names.
  const name = decodeURIComponent(segment);
  return <ArtistDetailPage key={name} name={name} />;
}
