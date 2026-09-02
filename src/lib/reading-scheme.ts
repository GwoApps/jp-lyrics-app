import type { ReadingScheme, SongData } from '@/lib/types';

/** Persist a reading-scheme preference change (and/or the confirmation flag)
 *  via the song PUT endpoint. Throws on non-OK so callers can surface a toast. */
export async function updateReadingScheme(
  id: string,
  payload: { reading_scheme?: ReadingScheme; reading_scheme_confirmed: boolean },
): Promise<SongData> {
  const response = await fetch(`/api/songs/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error('reading_scheme_update_failed');
  return (await response.json()) as SongData;
}
