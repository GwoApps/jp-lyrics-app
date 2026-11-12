import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PIP_CANVAS_SOURCE_FONT_PX,
  clusterRowTops,
  drawPipCanvasLine,
  mergeCharsIntoFragments,
  pairReadingRows,
  type PipCanvasCharBox,
  type PipCanvasContext,
  type PipCanvasFragment,
  type PipCanvasLine,
} from './pip-canvas.ts';

function box(text: string, left: number, top: number, width = 38): PipCanvasCharBox {
  return { text, left, top, width, height: 44 };
}

test('clusterRowTops: one entry per visual row, sub-pixel noise ignored', () => {
  const tops = clusterRowTops([
    box('季', 0, 19),
    box('節', 38, 19.4),
    box('は', 76, 19),
    box('巡', 0, 78),
    box('り', 38, 78.3),
  ]);
  assert.deepEqual(tops, [19, 78]);
});

test('clusterRowTops: empty line yields no rows', () => {
  assert.deepEqual(clusterRowTops([]), []);
});

test('mergeCharsIntoFragments: rows split fragments, baselines follow the row top', () => {
  const boxes = [box('名', 0, 19), box('前', 38, 19), box('を', 76, 19), box('呼', 0, 78), box('ぶ', 38, 78)];
  const fragments = mergeCharsIntoFragments(boxes, [19, 78], 35);
  assert.equal(fragments.length, 2);
  assert.deepEqual(fragments.map((f) => f.text), ['名前を', '呼ぶ']);
  assert.deepEqual(fragments.map((f) => f.row), [0, 1]);
  // Widths span the whole merged run, so a fragment can be centred/diffed later.
  assert.equal(fragments[0].left, 0);
  assert.equal(fragments[0].width, 114);
  assert.deepEqual(fragments.map((f) => f.baseline), [54, 113]);
  // Merge mutates nothing in the caller's data.
  assert.equal(boxes[0].text, '名');
});

test('mergeCharsIntoFragments: a run that wraps yields one fragment per row in order', () => {
  const boxes = [box('う', 76, 78), box('の', 114, 78), box('だ', 0, 137)];
  const fragments = mergeCharsIntoFragments(boxes, [78, 137], 35);
  assert.deepEqual(fragments.map((f) => [f.text, f.row]), [['うの', 0], ['だ', 1]]);
});

test('pairReadingRows: equal fragment counts pair by index (ruby wrapped with its base)', () => {
  const base: PipCanvasFragment[] = [
    { ...box('呼', 0, 19), row: 0, baseline: 54 },
    { ...box('ぶ', 0, 78), row: 1, baseline: 113 },
  ];
  const reading: PipCanvasFragment[] = [
    { ...box('よ', 0, -1, 38), row: 0, baseline: 0 },
    { ...box('ぶ', 0, 58, 38), row: 0, baseline: 0 },
  ];
  const paired = pairReadingRows(base, reading, [19, 78], 44);
  assert.deepEqual(paired.map((f) => f.row), [0, 1]);
});

test('pairReadingRows: mismatched counts fall back to vertical overlap', () => {
  const base: PipCanvasFragment[] = [
    { ...box('呼', 0, 19), row: 0, baseline: 54 },
    { ...box('ぶ', 0, 78), row: 1, baseline: 113 },
  ];
  const reading: PipCanvasFragment[] = [
    { ...box('よぶ', 0, 58, 76), row: 0, baseline: 0 },
  ];
  const paired = pairReadingRows(base, reading, [19, 78], 44);
  assert.deepEqual(paired.map((f) => f.row), [1]);
});

/** Records every fillText call plus the state it was drawn with. */
function mockContext(): PipCanvasContext & {
  calls: { text: string; x: number; y: number; font: string; baseline: string; align: string; fillStyle: string }[];
} {
  const calls: { text: string; x: number; y: number; font: string; baseline: string; align: string; fillStyle: string }[] = [];
  const ctx = {
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillStyle: '',
    calls,
    fillText(text: string, x: number, y: number) {
      calls.push({
        text, x, y,
        font: this.font,
        baseline: this.textBaseline,
        align: this.textAlign,
        fillStyle: String(this.fillStyle),
      });
    },
    measureText(text: string) {
      return { width: text.length * 38 };
    },
  };
  return ctx;
}

function rubyLine(): PipCanvasLine {
  // 「君(きみ)の名前(なまえ)」 — kanji runs carry a reading, the kana run does not.
  const runs = [
    {
      fragments: mergeCharsIntoFragments([box('君', 0, 19)], [19], 35),
      reading: 'きみ',
      readingFragments: [{ ...box('きみ', 0, -1, 38), height: 22, row: 0, baseline: 0 }],
    },
    {
      fragments: mergeCharsIntoFragments([box('の', 38, 19)], [19], 35),
      reading: '',
      readingFragments: [],
    },
    {
      fragments: mergeCharsIntoFragments([box('名前', 76, 19)], [19], 35),
      reading: 'なまえ',
      readingFragments: [{ ...box('なまえ', 76, -1, 76), height: 22, row: 0, baseline: 0 }],
    },
  ];
  return { runs, rowCount: 1, top: -1, bottom: 63 };
}

test('drawPipCanvasLine: kanji base text and its reading are both drawn', () => {
  const ctx = mockContext();
  drawPipCanvasLine(ctx, rubyLine(), { x: 32, y: 100, color: '#fff', readingColor: '#a1a1aa' });

  const texts = ctx.calls.map((c) => c.text);
  // Regression guard for the flattened video PiP: the kanji must survive.
  assert.deepEqual(texts, ['君', 'きみ', 'の', '名前', 'なまえ']);
  const base = ctx.calls.find((c) => c.text === '君')!;
  const reading = ctx.calls.find((c) => c.text === 'きみ')!;
  // y is the annotation's top edge, so row 0's baseline lands at y + (top->baseline).
  assert.equal(base.y, 100 - -1 + 54);
  assert.equal(base.baseline, 'alphabetic');
  assert.equal(base.font, `500 ${PIP_CANVAS_SOURCE_FONT_PX}px system-ui, -apple-system, sans-serif`);
  assert.equal(base.fillStyle, '#fff');
  // The reading sits in the annotation box above the base, centred on it.
  assert.equal(reading.baseline, 'bottom');
  assert.equal(reading.align, 'center');
  assert.equal(reading.x, 32 + 19);
  assert.equal(reading.y, 100 - -1 + 21);
  assert.equal(reading.font, `500 ${PIP_CANVAS_SOURCE_FONT_PX * 0.5}px system-ui, -apple-system, sans-serif`);
  assert.equal(reading.fillStyle, '#a1a1aa');
});

test('drawPipCanvasLine: maxRows clips wrapped rows but keeps the whole first row', () => {
  const runs = [
    {
      fragments: mergeCharsIntoFragments([box('出', 0, 19), box('会', 38, 19), box('う', 0, 78)], [19, 78], 35),
      reading: 'であ',
      readingFragments: [{ ...box('であ', 0, -1, 76), height: 22, row: 0, baseline: 0 }],
    },
  ];
  const line: PipCanvasLine = { runs, rowCount: 2, top: -1, bottom: 122 };
  const ctx = mockContext();
  const bottom = drawPipCanvasLine(ctx, line, { x: 0, y: 0, color: '#fff', readingColor: '#aaa', maxRows: 1 });
  assert.deepEqual(ctx.calls.map((c) => c.text), ['出会', 'であ']);
  // Row 1 ('う') is clipped, so the returned bottom stays inside the first row.
  assert.equal(bottom, 0 - -1 + 19 + 44);
});

test('drawPipCanvasLine: scale follows the requested source font size', () => {
  const ctx = mockContext();
  drawPipCanvasLine(ctx, rubyLine(), { x: 0, y: 0, color: '#fff', readingColor: '#aaa', sourceFontPx: 57 });
  const base = ctx.calls.find((c) => c.text === '君')!;
  assert.equal(base.font, '500 57px system-ui, -apple-system, sans-serif');
  // 1.5× scale: positions scale with the font so the frame can be up-scaled.
  assert.equal(base.y, 1 + 54 * 1.5);
});

test('drawPipCanvasLine: an empty line draws nothing and returns y unchanged', () => {
  const ctx = mockContext();
  const bottom = drawPipCanvasLine(ctx, { runs: [], rowCount: 0, top: 0, bottom: 0 }, {
    x: 32, y: 100, color: '#fff', readingColor: '#aaa',
  });
  assert.equal(ctx.calls.length, 0);
  assert.equal(bottom, 100);
});
