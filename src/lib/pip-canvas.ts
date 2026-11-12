/**
 * Canvas lyrics renderer for the Video PiP fallback.
 *
 * `pip-render.ts` renders the DOM PiP window with real `<ruby>` markup, but a
 * canvas has no ruby layout, so the video path used to flatten every annotated
 * segment to its reading (`usePiP.ts` picked the reading instead of the kanji —
 * a furigana line therefore lost all of its kanji). Re-implementing CJK line
 * breaking and ruby placement by hand in canvas would just be a worse copy of
 * what the engine already does, so this module borrows the engine's layout:
 *
 *   1. the exact `renderPipLyricsHtml` markup is laid out in a hidden container
 *      that shares the canvas font stack and size;
 *   2. the resulting geometry is read back (per-row run fragments, baselines,
 *      annotation boxes);
 *   3. canvas only blits the glyph runs at those measured positions.
 *
 * Wrapping, 禁則 line breaking and annotation centring stay the engine's job,
 * and a reading is never drawn without its base text.
 */

/** Font stack shared by the canvas draw calls and the hidden measurement DOM. */
export const PIP_CANVAS_FONT_FAMILY = 'system-ui, -apple-system, sans-serif';
/** Source lyric size in canvas px (the video PiP frame is 640×360). */
export const PIP_CANVAS_SOURCE_FONT_PX = 38;
/** Ruby annotation size relative to the base run (mirrors `ruby rt { font-size: 0.5em }`). */
export const PIP_CANVAS_READING_SCALE = 0.5;
/** Translation size in canvas px. */
export const PIP_CANVAS_TRANSLATION_FONT_PX = 24;
/**
 * Vertical layout of the video PiP frame (640×360).
 *
 * `VIDEO_PIP_CURRENT_TOP` is an annotation top rather than a baseline: every
 * source row needs its ruby annotation above it, and a measured line reports
 * that overhang in `PipCanvasLine.top`. Everything below it **flows**: the
 * translation hangs directly under the drawn source rows and the next-line
 * preview follows the translation. Fixed slots were wrong because a one-row
 * line then left the translation suspended far below it.
 */
export const VIDEO_PIP_CURRENT_TOP = 96;
/** Header band: title em top and size (the divider sits at y=66). */
export const VIDEO_PIP_TITLE_TOP = 30;
export const VIDEO_PIP_TITLE_FONT_PX = 18;
/** Gap between the source block's bottom and the translation's em top. */
export const VIDEO_PIP_TRANSLATION_GAP = 6;
/** Gap between the translation (or source block) and the next-line preview. */
export const VIDEO_PIP_NEXT_GAP = 16;

const MEASURE_HOST_CLASS = 'jplrc-pip-measure';
const MEASURE_MARKER_CLASS = 'jplrc-pip-measure-marker';
/** Two tops closer than this belong to the same visual row. */
const ROW_EPSILON = 1;

/** One character as laid out by the engine, in measurement-container px. */
export interface PipCanvasCharBox {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A contiguous run of characters the engine kept on one visual row. */
export interface PipCanvasFragment extends PipCanvasCharBox {
  /** 0-based visual row inside the measured line. */
  row: number;
  /** Alphabetic baseline (row top + the font's ascent), for base runs. */
  baseline: number;
}

/** One lyric segment: its base text fragments plus its (optional) annotation. */
export interface PipCanvasRun {
  /** Base fragments — kanji, kana and latin all land here. */
  fragments: PipCanvasFragment[];
  /** Reading text (`ruby rt`), empty when the segment is not annotated. */
  reading: string;
  readingFragments: PipCanvasFragment[];
}

export interface PipCanvasLine {
  runs: PipCanvasRun[];
  /** Number of visual rows the line wrapped into. */
  rowCount: number;
  /** Topmost edge incl. annotation overhang; the line's local origin. */
  top: number;
  /** Bottom edge of the last row's base text. */
  bottom: number;
}

/** Structural subset of `CanvasRenderingContext2D` — keeps the drawer testable. */
export interface PipCanvasContext {
  font: string;
  textAlign: string;
  textBaseline: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): {
    width: number;
    fontBoundingBoxAscent?: number;
    fontBoundingBoxDescent?: number;
  };
}

export interface PipCanvasDrawOptions {
  /** Left edge of the line, canvas px. */
  x: number;
  /** Top edge incl. annotation overhang, canvas px. */
  y: number;
  color: string;
  readingColor: string;
  /** Source size override (defaults to `PIP_CANVAS_SOURCE_FONT_PX`). */
  sourceFontPx?: number;
  /** Rows to draw before clipping (the next-line preview draws a single row). */
  maxRows?: number;
}

/** Distinct visual row tops, in reading order. */
export function clusterRowTops(boxes: readonly PipCanvasCharBox[]): number[] {
  const tops: number[] = [];
  for (const box of boxes) {
    if (!tops.some((top) => Math.abs(top - box.top) <= ROW_EPSILON)) tops.push(box.top);
  }
  return tops.sort((a, b) => a - b);
}

/** Merge consecutive characters that share a row into one drawable fragment. */
export function mergeCharsIntoFragments(
  boxes: readonly PipCanvasCharBox[],
  rowTops: readonly number[],
  baselineOffset: number,
): PipCanvasFragment[] {
  const fragments: PipCanvasFragment[] = [];
  for (const box of boxes) {
    const row = nearestRow(box.top, rowTops);
    const last = fragments.at(-1);
    if (last && last.row === row) {
      last.text += box.text;
      last.width = box.left + box.width - last.left;
      last.height = Math.max(last.height, box.height);
      continue;
    }
    fragments.push({ ...box, row, baseline: (rowTops[row] ?? box.top) + baselineOffset });
  }
  return fragments;
}

function nearestRow(top: number, rowTops: readonly number[]): number {
  let best = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  rowTops.forEach((rowTop, index) => {
    const delta = Math.abs(rowTop - top);
    if (delta < bestDelta) {
      best = index;
      bestDelta = delta;
    }
  });
  return best;
}

/**
 * Assign every annotation fragment to a base row. A ruby that wraps yields one
 * base and one annotation fragment per row, in the same order, so index pairing
 * is exact; the vertical-overlap fallback only runs when the engine split the
 * two sides differently.
 */
export function pairReadingRows(
  baseFragments: readonly PipCanvasFragment[],
  readingFragments: readonly PipCanvasFragment[],
  rowTops: readonly number[],
  baseHeight: number,
): PipCanvasFragment[] {
  if (readingFragments.length === baseFragments.length) {
    return readingFragments.map((fragment, index) => ({ ...fragment, row: baseFragments[index].row }));
  }
  return readingFragments.map((fragment) => {
    let best = 0;
    let bestOverlap = -1;
    rowTops.forEach((rowTop, index) => {
      const bandTop = rowTop - fragment.height;
      const bandBottom = rowTop + baseHeight;
      const overlap = Math.min(fragment.top + fragment.height, bandBottom) - Math.max(fragment.top, bandTop);
      if (overlap > bestOverlap) {
        best = index;
        bestOverlap = overlap;
      }
    });
    return { ...fragment, row: best };
  });
}

/** Draw one measured line. Returns the y coordinate just below the drawn rows. */
export function drawPipCanvasLine(
  ctx: PipCanvasContext,
  line: PipCanvasLine,
  options: PipCanvasDrawOptions,
): number {
  const sourceFontPx = options.sourceFontPx ?? PIP_CANVAS_SOURCE_FONT_PX;
  const scale = sourceFontPx / PIP_CANVAS_SOURCE_FONT_PX;
  const readingFontPx = sourceFontPx * PIP_CANVAS_READING_SCALE;
  const maxRows = options.maxRows ?? Number.POSITIVE_INFINITY;
  const dy = options.y - line.top;
  let drawnBottom = options.y;

  ctx.textAlign = 'left';
  for (const run of line.runs) {
    const baseFragments = run.fragments.filter((fragment) => fragment.row < maxRows);
    if (baseFragments.length > 0) {
      ctx.font = `500 ${sourceFontPx}px ${PIP_CANVAS_FONT_FAMILY}`;
      ctx.fillStyle = options.color;
      ctx.textBaseline = 'alphabetic';
      for (const fragment of baseFragments) {
        ctx.fillText(fragment.text, options.x + fragment.left * scale, dy + fragment.baseline * scale);
        drawnBottom = Math.max(drawnBottom, dy + (fragment.top + fragment.height) * scale);
      }
    }
    const readingFragments = run.readingFragments.filter((fragment) => fragment.row < maxRows);
    if (run.reading && readingFragments.length > 0) {
      ctx.font = `500 ${readingFontPx}px ${PIP_CANVAS_FONT_FAMILY}`;
      ctx.fillStyle = options.readingColor;
      // The engine stretches the annotation box to the base width and centres
      // the reading inside it; `bottom` == the annotation box's bottom edge, so
      // no font-metric maths is needed to reproduce the native offset.
      ctx.textBaseline = 'bottom';
      ctx.textAlign = 'center';
      for (const fragment of readingFragments) {
        ctx.fillText(
          fragment.text,
          options.x + (fragment.left + fragment.width / 2) * scale,
          dy + (fragment.top + fragment.height) * scale,
        );
        drawnBottom = Math.max(drawnBottom, dy + (fragment.top + fragment.height) * scale);
      }
      ctx.textAlign = 'left';
    }
  }
  ctx.textBaseline = 'alphabetic';
  return drawnBottom;
}

export interface PipCanvasTextOptions {
  /** Left edge, canvas px. */
  x: number;
  /** Em-box top, canvas px (not a baseline — the caller flows blocks by top). */
  top: number;
  /** Font size in canvas px; the weight is fixed at 400. */
  fontPx: number;
  weight?: number;
  color: string;
  /** Truncate with an ellipsis when the text is wider than this. */
  maxWidth?: number;
}

/**
 * Draw one plain (ruby-free) text line with its em top at `options.top`.
 * Returns the em bottom, so callers can flow the next block.
 */
export function drawPipCanvasText(
  ctx: PipCanvasContext,
  text: string,
  options: PipCanvasTextOptions,
): number {
  const { ascent, descent } = fontMetrics(ctx, options.fontPx, `${options.weight ?? 400} ${options.fontPx}px ${PIP_CANVAS_FONT_FAMILY}`, text);
  ctx.font = `${options.weight ?? 400} ${options.fontPx}px ${PIP_CANVAS_FONT_FAMILY}`;
  ctx.fillStyle = options.color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const content = options.maxWidth != null ? truncateToWidth(ctx, text, options.maxWidth) : text;
  if (content.length > 0) ctx.fillText(content, options.x, options.top + ascent);
  return options.top + ascent + descent;
}

/**
 * Vertical metrics of the current font. `fontBoundingBox*` is what the engine
 * uses for the em box; the 0.88/0.12 split only backs up engines that report no
 * metrics at all (kept out of the layout critical path by the caller tests).
 */
function fontMetrics(
  ctx: PipCanvasContext,
  fontPx: number,
  font: string,
  text: string,
): { ascent: number; descent: number } {
  ctx.font = font;
  const metrics = ctx.measureText(text || ' ');
  const ascent = metrics.fontBoundingBoxAscent;
  const descent = metrics.fontBoundingBoxDescent;
  if (typeof ascent === 'number' && typeof descent === 'number' && ascent > 0) {
    return { ascent, descent };
  }
  return { ascent: fontPx * 0.88, descent: fontPx * 0.12 };
}

function truncateToWidth(ctx: PipCanvasContext, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const shortened = Array.from(text);
  while (shortened.length > 1 && ctx.measureText(`${shortened.join('')}…`).width > maxWidth) shortened.pop();
  return `${shortened.join('')}…`;
}

/* ------------------------------------------------------------------ */
/* Measurement (browser only)                                          */
/* ------------------------------------------------------------------ */

/**
 * The measurement markup lives in a **shadow root**: the app's global stylesheet
 * carries per-language font rules (`[lang="ja"] { font-family: 'Noto Sans JP' }`
 * in `globals.css`), and those attribute selectors would otherwise hit the
 * hidden `lang="ja"` lyric markup. That gives the engine one font while the
 * canvas draws with another, so every run lands at the wrong x/height (CJK
 * advances hide it, Latin readings and vertical metrics do not — measured
 * deltas of 2px ascent and 7.6px per romaji run). Shadow DOM keeps the layout
 * engine's font identical to the canvas font; no `!important` arms race needed.
 */
let measureHostEl: HTMLElement | null = null;
let measureBodyEl: HTMLElement | null = null;

function ensureMeasureHost(widthPx: number): HTMLElement {
  if (!measureHostEl || !measureBodyEl || !measureHostEl.isConnected) {
    const host = document.createElement('div');
    host.className = MEASURE_HOST_CLASS;
    host.setAttribute('aria-hidden', 'true');
    Object.assign(host.style, {
      position: 'fixed',
      left: '-20000px',
      top: '0',
      visibility: 'hidden',
      pointerEvents: 'none',
      contain: 'layout style',
    });
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      .body { font-family: ${PIP_CANVAS_FONT_FAMILY}; }
      .line { font-size: ${PIP_CANVAS_SOURCE_FONT_PX}px; font-weight: 500; line-height: normal; font-family: ${PIP_CANVAS_FONT_FAMILY}; }
      .line-source { font-weight: 500; font-family: ${PIP_CANVAS_FONT_FAMILY}; }
      ruby rt { font-size: ${PIP_CANVAS_READING_SCALE * 100}%; font-weight: 500; font-family: ${PIP_CANVAS_FONT_FAMILY}; }
      .translation { display: none; }
      .${MEASURE_MARKER_CLASS} { display: inline-block; width: 0; height: 0; }
    `;
    shadow.appendChild(style);
    measureBodyEl = document.createElement('div');
    measureBodyEl.className = 'body';
    shadow.appendChild(measureBodyEl);
    document.body.appendChild(host);
    measureHostEl = host;
  }
  measureBodyEl.style.width = `${widthPx}px`;
  return measureBodyEl;
}

/** Drop the hidden measurement container (called when the video PiP unmounts). */
export function resetPipCanvasMeasureHost(): void {
  measureHostEl?.remove();
  measureHostEl = null;
  measureBodyEl = null;
}

function charBoxesForTextNode(node: Text, originLeft: number, originTop: number): PipCanvasCharBox[] {
  const boxes: PipCanvasCharBox[] = [];
  const chars = Array.from(node.data);
  if (chars.length === 0) return boxes;
  const range = document.createRange();
  let offset = 0;
  for (const char of chars) {
    range.setStart(node, offset);
    range.setEnd(node, offset + char.length);
    offset += char.length;
    const rect = range.getBoundingClientRect();
    // A collapsed space has no box; keeping it would draw nothing but would
    // still widen the fragment, so it is dropped (the engine already broke the
    // line there, or the space is invisible in canvas too).
    if (rect.width === 0 && rect.height === 0) continue;
    boxes.push({
      text: char,
      left: rect.left - originLeft,
      top: rect.top - originTop,
      width: rect.width,
      height: rect.height,
    });
  }
  return boxes;
}

function firstTextChild(element: Element): Text | null {
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) return node as Text;
  }
  return null;
}

function measureLine(lineEl: Element): PipCanvasLine {
  const source = lineEl.querySelector('.line-source') ?? lineEl;
  const marker = document.createElement('i');
  marker.className = MEASURE_MARKER_CLASS;
  source.insertBefore(marker, source.firstChild);

  // Geometry is read in viewport coordinates and rebased onto the line: the
  // measurement container is parked far off-screen, so its own origin must not
  // leak into the fragment positions the canvas draws with.
  const sourceRect = source.getBoundingClientRect();
  const originLeft = sourceRect.left;
  const originTop = sourceRect.top;
  const pending: { base: Text; reading: Text | null }[] = [];
  for (const child of Array.from(source.childNodes)) {
    if (child === marker) continue;
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child as Text;
      if (text.data.length > 0) pending.push({ base: text, reading: null });
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const element = child as Element;
    if (element.tagName.toLowerCase() !== 'ruby') continue;
    const base = firstTextChild(element);
    if (!base) continue;
    const rt = element.querySelector('rt');
    pending.push({ base, reading: rt ? firstTextChild(rt) : null });
  }

  const measured = pending.map((entry) => ({
    baseBoxes: charBoxesForTextNode(entry.base, originLeft, originTop),
    readingText: entry.reading?.data ?? '',
    readingBoxes: entry.reading ? charBoxesForTextNode(entry.reading, originLeft, originTop) : [],
  }));

  const rowTops = clusterRowTops(measured.flatMap((entry) => entry.baseBoxes));
  const markerRect = marker.getBoundingClientRect();
  // A zero-height inline-block sits on the line's baseline, so its bottom edge
  // is the exact baseline the engine used — no ascent guesswork.
  const baselineOffset = rowTops.length > 0 ? (markerRect.bottom - originTop) - rowTops[0] : 0;
  const baseHeight = measured.flatMap((entry) => entry.baseBoxes).reduce((max, box) => Math.max(max, box.height), 0);

  const runs: PipCanvasRun[] = measured.map((entry) => {
    const fragments = mergeCharsIntoFragments(entry.baseBoxes, rowTops, baselineOffset);
    const readingFragments = entry.readingBoxes.length > 0
      ? pairReadingRows(
          fragments,
          mergeCharsIntoFragments(entry.readingBoxes, clusterRowTops(entry.readingBoxes), 0),
          rowTops,
          baseHeight,
        )
      : [];
    return { fragments, reading: entry.readingText, readingFragments };
  });

  marker.remove();

  const allFragments = runs.flatMap((run) => [...run.fragments, ...run.readingFragments]);
  const top = allFragments.reduce((min, fragment) => Math.min(min, fragment.top), 0);
  const bottom = runs
    .flatMap((run) => run.fragments)
    .reduce((max, fragment) => Math.max(max, fragment.top + fragment.height), 0);

  return { runs, rowCount: rowTops.length, top, bottom };
}

/**
 * Lay `html` (the output of `renderPipLyricsHtml`, one or more `.line` blocks)
 * out in the hidden container and read its geometry. Returns one entry per
 * `.line`, in document order; empty array outside the browser.
 */
export function measurePipCanvasLines(html: string, widthPx: number): PipCanvasLine[] {
  if (typeof document === 'undefined' || html.length === 0) return [];
  const host = ensureMeasureHost(widthPx);
  host.innerHTML = html;
  return Array.from(host.querySelectorAll('.line')).map((lineEl) => measureLine(lineEl));
}
