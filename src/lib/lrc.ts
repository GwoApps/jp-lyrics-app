/** Parsed LRC sync line */
export interface SyncLine {
  timeMs: number;
  text: string;
}

/** Editable timeline row. A null timestamp means the lyric line has not been marked yet. */
export interface TimelineDraftLine {
  timeMs: number | null;
  text: string;
}

/** Return lyric text from standard or partially annotated LRC, preserving row order. */
export function getLrcTextLines(value: string): string[] {
  return value.split('\n').flatMap((raw) => {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    const timestamped = trimmed.match(/^\[\d{2}:\d{2}\.\d{2,3}\]\s*(.*)$/);
    const text = (timestamped?.[1] ?? trimmed).trim();
    return text ? [text] : [];
  });
}

/** Build an editor draft from plain lyrics and any existing full or partial LRC. */
export function createTimelineDraft(plainLyrics: string, syncedLyrics: string): TimelineDraftLine[] {
  const plain = plainLyrics.split('\n').map((line) => line.trim()).filter(Boolean);
  const syncedRows = syncedLyrics.split('\n').flatMap<TimelineDraftLine>((raw) => {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    const match = trimmed.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)$/);
    if (!match) return [{ timeMs: null, text: trimmed }];
    const text = match[4].trim();
    if (!text) return [];
    return [{
      timeMs: Number.parseInt(match[1], 10) * 60000
        + Number.parseInt(match[2], 10) * 1000
        + Number.parseInt(match[3].padEnd(3, '0'), 10),
      text,
    }];
  });

  if (plain.length === 0) return syncedRows;
  if (syncedRows.length === plain.length && syncedRows.every((row, index) => row.text === plain[index])) {
    return syncedRows;
  }

  const timestampQueues = new Map<string, number[]>();
  for (const row of syncedRows) {
    if (row.timeMs == null) continue;
    const queue = timestampQueues.get(row.text) ?? [];
    queue.push(row.timeMs);
    timestampQueues.set(row.text, queue);
  }
  return plain.map((text) => ({ text, timeMs: timestampQueues.get(text)?.shift() ?? null }));
}

/**
 * Align a non-blank timeline draft to rendered lyric rows that may preserve blank separators.
 * Blank rendered rows do not consume a timeline entry.
 */
export function mapTimelineTimestamps(
  renderedRows: string[],
  plainLyrics: string,
  syncedLyrics: string,
): (number | null)[] {
  const draft = createTimelineDraft(plainLyrics, syncedLyrics);
  let draftIndex = 0;
  return renderedRows.map((text) => {
    if (!text.trim()) return null;
    const timestamp = draft[draftIndex]?.timeMs ?? null;
    draftIndex += 1;
    return timestamp;
  });
}

/** Serialize a full or partial draft. Untimed rows remain plain so draft progress is not lost. */
export function serializeTimelineDraft(lines: TimelineDraftLine[]): string {
  return lines.map((line) => line.timeMs == null
    ? line.text
    : `[${fmtMs(line.timeMs)}]${line.text}`
  ).join('\n');
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
  const leftText = getLrcTextLines(left);
  const rightText = getLrcTextLines(right);
  return leftText.length === rightText.length
    && leftText.every((text, index) => text === rightText[index]);
}

/** Resolve a submitted LRC without touching plain lyrics for timestamp-only edits. */
export function resolveLrcTextUpdate(existingRaw: string, existingSynced: string, submittedSynced: string) {
  if (hasSameLrcText(existingSynced, submittedSynced)) {
    return { lyricsRaw: existingRaw, contentChanged: false };
  }
  const submittedText = getLrcTextLines(submittedSynced);
  const existingText = getLrcTextLines(existingRaw);
  if (submittedText.length === existingText.length
    && submittedText.every((text, index) => text === existingText[index])) {
    return { lyricsRaw: existingRaw, contentChanged: false };
  }
  const lyricsRaw = submittedText.join('\n');
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
