/** Parsed LRC sync line */
export interface SyncLine {
  timeMs: number;
  text: string;
}

/** Parse LRC timestamp text into sorted SyncLine array */
export function parseLrc(lrc: string): SyncLine[] {
  const lines: SyncLine[] = [];
  for (const raw of lrc.split('\n')) {
    const m = raw.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)$/);
    if (m) {
      const ms = parseInt(m[1]) * 60000 + parseInt(m[2]) * 1000 + parseInt(m[3].padEnd(3, '0'));
      const text = m[4].trim();
      if (text) lines.push({ timeMs: ms, text });
    }
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

/** Shift all timestamps by an offset, clamping negative values to zero. */
export function offsetLrcLines(syncLines: SyncLine[], offsetMs: number): SyncLine[] {
  return syncLines.map((line) => ({
    ...line,
    timeMs: Math.max(0, Math.round(line.timeMs + offsetMs)),
  }));
}

/** Update one line timestamp and return a chronologically sorted copy. */
export function updateLrcLineTime(syncLines: SyncLine[], index: number, timeMs: number): SyncLine[] {
  return syncLines
    .map((line, lineIndex) => lineIndex === index
      ? { ...line, timeMs: Math.max(0, Math.round(timeMs)) }
      : { ...line })
    .sort((a, b) => a.timeMs - b.timeMs);
}

/** Serialize sync lines using millisecond-precision LRC timestamps. */
export function serializeLrc(syncLines: SyncLine[]): string {
  return [...syncLines]
    .sort((a, b) => a.timeMs - b.timeMs)
    .map((line) => `[${fmtMs(line.timeMs)}]${line.text}`)
    .join('\n');
}

/** Compare only the ordered lyric text, ignoring all timestamp changes. */
export function hasSameLrcText(left: string, right: string): boolean {
  const leftText = parseLrc(left).map((line) => line.text);
  const rightText = parseLrc(right).map((line) => line.text);
  return leftText.length === rightText.length
    && leftText.every((text, index) => text === rightText[index]);
}

/** Resolve a submitted LRC without touching plain lyrics for timestamp-only edits. */
export function resolveLrcTextUpdate(existingRaw: string, existingSynced: string, submittedSynced: string) {
  if (hasSameLrcText(existingSynced, submittedSynced)) {
    return { lyricsRaw: existingRaw, contentChanged: false };
  }
  const lyricsRaw = parseLrc(submittedSynced).map((line) => line.text).join('\n');
  return { lyricsRaw, contentChanged: lyricsRaw !== existingRaw };
}

/** Parse an editor timestamp in M:SS, M:SS.d, M:SS.dd or M:SS.ddd form. */
export function parseLrcTimestamp(value: string): number | null {
  const match = value.trim().match(/^(\d+):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) return null;
  const seconds = Number.parseInt(match[2], 10);
  if (seconds >= 60) return null;
  const fraction = (match[3] || '').padEnd(3, '0');
  return Number.parseInt(match[1], 10) * 60000
    + seconds * 1000
    + (fraction ? Number.parseInt(fraction, 10) : 0);
}

/** Find the active sync line index for a given progress position */
export function findActiveLine(syncLines: SyncLine[], progressMs: number): number {
  for (let i = syncLines.length - 1; i >= 0; i--) {
    if (progressMs >= syncLines[i].timeMs) return i;
  }
  return 0;
}

/** Format milliseconds as MM:SS.mmm (for debug display) */
export function fmtMs(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const ss = ms % 1000;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ss).padStart(3, '0')}`;
}

/** Format milliseconds as M:SS (for progress display) */
export function fmtTime(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
}
