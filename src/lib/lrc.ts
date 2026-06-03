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
