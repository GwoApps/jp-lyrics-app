// A successful Spotify seek has no track ID in its response. The pre-seek
// track check is authoritative only when post-seek playback cannot be read.
export function seekReceiptTrackId(
  expectedTrackId: string,
  postSeek: { id: string | null; available: boolean } | null,
): string | null {
  return postSeek?.available ? postSeek.id : expectedTrackId;
}
