'use client';

import { useCallback, useState } from 'react';
import { useStoredPreference } from '@/lib/browser-storage';
import {
  LYRICS_ENTITY_NOTICE_KIND,
  hasLyricsHtmlEntity,
  lyricsEntityNoticeKey,
  parseDeclinedFixes,
  serializeDeclinedFixes,
} from '@/lib/lyrics-entity';
import type { SongData } from '@/lib/types';

interface Deps {
  id: string;
  song: SongData | null;
  refreshSong: () => Promise<unknown>;
  showToast: (type: 'success' | 'error' | 'info', msg: string) => void;
  t: (key: string, params?: Record<string, string>) => string;
}

export interface UseLyricsEntityRepairReturn {
  /** The owner is being asked whether to decode this song's lyrics. */
  needsRepair: boolean;
  repairing: boolean;
  /** Run the repair (the route is the only writer). */
  repair: () => Promise<void>;
  /** Remember the refusal for this song so the same question is never asked twice. */
  decline: () => void;
}

/** Everything the repair can change; identifies "the lyrics we already fixed". */
function lyricsSignature(song: SongData | null): string {
  return song ? [song.lyrics_raw, song.lyrics_synced, song.lyrics_furigana].join('\u0000') : '';
}

/**
 * Offer — never perform — the HTML-entity repair for one song (ISSUE #428).
 *
 * PetitLyrics lyrics reached the database encoded, so a few rows still show
 * `fallin&#039; down`. Rewriting somebody's lyrics is an edit, not a storage
 * format fix (contrast the automatic CRLF fold of #421), so nothing happens
 * until the owner says yes:
 *
 * - the banner only renders for a song the viewer can edit whose stored text or
 *   reading cache still carries an entity;
 * - a refusal is remembered per song and per lyrics text under
 *   `jplrc:song:<id>:declined-fix:<fingerprint>`, so the same question can never
 *   come back for the same lyrics (a genuinely new document asks again);
 * - once repaired, the signature of the fixed lyrics is remembered locally, so
 *   the banner cannot flash back if the follow-up re-read fails.
 */
export function useLyricsEntityRepair(deps: Deps): UseLyricsEntityRepairReturn {
  const { id, song, refreshSong, showToast, t } = deps;

  // Hydration-safe: `localStorage` is invisible to the server, so a stored
  // refusal is adopted one render after the server markup. The key carries the
  // lyrics fingerprint, so a refusal can only ever silence the exact text the
  // owner declined to fix.
  const [declined, setDeclined] = useStoredPreference(
    lyricsEntityNoticeKey(id, song?.lyrics_raw ?? ''),
    parseDeclinedFixes,
    serializeDeclinedFixes,
  );

  const [repairing, setRepairing] = useState(false);
  const [repairedSignature, setRepairedSignature] = useState<string | null>(null);

  const signature = lyricsSignature(song);
  const needsRepair = !repairing
    && song?.permissions?.can_edit === true
    && signature !== repairedSignature
    && hasLyricsHtmlEntity(song.lyrics_raw, song.lyrics_synced, song.lyrics_furigana)
    && !declined.includes(LYRICS_ENTITY_NOTICE_KIND);

  const repair = useCallback(async () => {
    const attempted = lyricsSignature(song);
    setRepairing(true);
    try {
      const res = await fetch(`/api/songs/${id}/repair-lyrics-entities`, { method: 'POST' });
      if (!res.ok) {
        showToast('error', t('song.entityRepairFailed'));
        return;
      }
      const data = await res.json().catch(() => null) as { changed?: boolean } | null;
      setRepairedSignature(attempted);
      showToast('success', t(data?.changed === false ? 'song.entityRepairNothing' : 'song.entityRepairDone'));
      await refreshSong();
    } catch {
      showToast('error', t('song.entityRepairFailed'));
    } finally {
      setRepairing(false);
    }
  }, [id, song, refreshSong, showToast, t]);

  const decline = useCallback(() => {
    setDeclined((previous) => [...new Set([...previous, LYRICS_ENTITY_NOTICE_KIND])]);
  }, [setDeclined]);

  return { needsRepair, repairing, repair, decline };
}
