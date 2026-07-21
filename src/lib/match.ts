/**
 * Song matching utility — used by homepage and detail page to match
 * Spotify "now playing" tracks to database songs.
 *
 * Strategy:
 *  1. Normalize (NFKC, strip whitespace, lowercase)
 *  2. Title match: exact / substring (with length guard) / bigram Dice
 *  3. Artist bonus: if both sides have artist info, require partial match
 *  4. Composite score → pick best candidate
 */

// ─── Primitives ───────────────────────────────────────────────

export function normalize(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

/** Sørensen-Dice bigram coefficient (0–1) */
function bigramDice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const bg = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.substring(i, i + 2));
    return set;
  };
  const aSet = bg(a);
  const bSet = bg(b);
  let common = 0;
  for (const g of aSet) {
    if (bSet.has(g)) common++;
  }
  return (2 * common) / (aSet.size + bSet.size);
}

// ─── Title matching (strict) ─────────────────────────────────

/**
 * Returns a title similarity score (0–1).
 *  - 1.0  exact match
 *  - ≥0.8 substring match (shorter must be ≥ 70% of longer's length)
 *  - ≥0.6 bigram Dice
 *  - 0    no match
 *
 * Substring containment alone is NOT enough — the shorter string must
 * cover at least 70% of the longer one's character count.
 * This prevents "GAME" from matching "さよならアンドロメダ - GAME VERSION".
 */
export function titleScore(rawA: string, rawB: string): number {
  const a = normalize(rawA);
  const b = normalize(rawB);
  if (!a || !b) return 0;

  // Exact
  if (a === b) return 1;

  // Substring with length guard (shorter ≥ 70% of longer)
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  if (longer.includes(shorter) && shorter.length >= longer.length * 0.7) {
    return 0.85;
  }

  // Bigram Dice
  const dice = bigramDice(a, b);
  if (dice >= 0.55) return dice;

  return 0;
}

/** Boolean: do these two titles match at all? (threshold ≥ 0.55) */
export function isTitleMatch(a: string, b: string): boolean {
  return titleScore(a, b) >= 0.55;
}

// ─── Artist matching ──────────────────────────────────────────

/**
 * Artist similarity score (0–1).
 * Handles multi-artist strings like "Artist A, Artist B" by checking
 * whether any sub-artist overlaps.
 */
export function artistScore(rawA: string, rawB: string): number {
  const a = normalize(rawA);
  const b = normalize(rawB);
  if (!a || !b) return 0.5; // No info → neutral (don't penalize)
  if (a === b) return 1;

  // Split by common separators and check sub-artist overlap
  const splitArtist = (s: string) =>
    s.split(/[,、&／/]/).map((p) => p.trim()).filter(Boolean);
  const aParts = splitArtist(a);
  const bParts = splitArtist(b);

  // Any sub-artist exact or substring match
  for (const ap of aParts) {
    for (const bp of bParts) {
      if (ap === bp) return 1;
      if (ap.includes(bp) || bp.includes(ap)) return 0.8;
      if (bigramDice(ap, bp) >= 0.6) return 0.7;
    }
  }

  // Full-string bigram
  return bigramDice(a, b);
}

// ─── Composite song matching ──────────────────────────────────

export interface SongCandidate {
  id: string;
  title: string;
  artist: string;
  spotify_track_id?: string | null;
  created_by?: string;
  is_public?: number;
}

export interface PlayingTrack {
  id?: string;
  name: string;
  artist: string;
}

/**
 * Compute a composite match score for a DB song vs the Spotify track.
 *  - Title: 70% weight
 *  - Artist: 30% weight (only when both sides have artist info)
 */
export function songMatchScore(
  song: SongCandidate,
  track: PlayingTrack,
): number {
  if (song.spotify_track_id && track.id && song.spotify_track_id === track.id) return 1;
  const tScore = titleScore(song.title, track.name);
  if (tScore < 0.55) return 0; // Title must pass threshold

  const aScore = artistScore(song.artist, track.artist);
  return tScore * 0.7 + aScore * 0.3;
}

/**
 * Find the best-matching DB song for a Spotify track.
 *
 * Priority:
 *   1. User's own songs (any visibility)
 *   2. Public songs from other users
 *   3. Never match non-public songs from other users
 *
 * Returns null if no song passes the threshold.
 */
export function findBestMatch(
  songs: SongCandidate[],
  track: PlayingTrack | null | undefined,
  currentUserEmail?: string,
): SongCandidate | null {
  if (!track) return null;

  let bestOwn: SongCandidate | null = null;
  let bestOwnScore = 0;
  let bestPublic: SongCandidate | null = null;
  let bestPublicScore = 0;

  for (const song of songs) {
    const score = songMatchScore(song, track);
    if (score < 0.5) continue;

    const isOwn = currentUserEmail && song.created_by === currentUserEmail;
    const isPublic = song.is_public === 1;

    if (isOwn) {
      if (score > bestOwnScore) {
        bestOwnScore = score;
        bestOwn = song;
      }
    } else if (isPublic) {
      if (score > bestPublicScore) {
        bestPublicScore = score;
        bestPublic = song;
      }
    }
    // Non-public songs from other users are ignored
  }

  return bestOwn || bestPublic || null;
}

/**
 * Check if a specific song is the one currently playing on Spotify.
 * Used for highlighting in the song list.
 *
 * Only matches: own songs (any visibility) or public songs.
 */
export function isSongPlaying(
  song: SongCandidate,
  track: PlayingTrack | null | undefined,
  currentUserEmail?: string,
): boolean {
  if (!track) return false;
  if (songMatchScore(song, track) < 0.5) return false;

  // Own songs always match
  if (currentUserEmail && song.created_by === currentUserEmail) return true;
  // Public songs match
  if (song.is_public === 1) return true;
  // Non-public songs from others don't match
  return false;
}

// ─── Lyrics line matching (looser) ────────────────────────────

/**
 * Loose fuzzy match for lyrics line text (used for timestamp alignment).
 * Keeps a lower threshold because lyrics lines can have minor variations
 * between furigana source and synced LRC source.
 */
export function lineFuzzyMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  return bigramDice(na, nb) >= 0.4;
}
