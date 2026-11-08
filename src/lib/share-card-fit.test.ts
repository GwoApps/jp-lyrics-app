import test from 'node:test';
import assert from 'node:assert/strict';
import { drawCard, lyricWindowStart, type LyricLine, type ShareSong } from './share-card.ts';

// Issue #285: the card used to drop overflowing lyric lines silently. These
// tests pin the contract that made the loss visible: a contiguous window plus a
// report of what actually fit.

function lyric(text: string, index: number, translation: string | null): LyricLine {
  return { text, translation, index, lang: 'ja', translationLang: translation ? 'zh-CN' : null };
}

/** Just enough of a 2D context to exercise measuring and drawing. */
function fakeContext() {
  const drawn: string[] = [];
  const ctx = {
    font: '28px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillStyle: '#000',
    /** One width unit per character: nothing wraps below `maxWidth` characters. */
    measureText(text: string) {
      return { width: text.length };
    },
    fillText(text: string) {
      drawn.push(text);
    },
    save() {},
    restore() {},
    clip() {},
    drawImage() {},
    fillRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    closePath() {},
    createLinearGradient() {
      return { addColorStop() {} };
    },
    createRadialGradient() {
      return { addColorStop() {} };
    },
  };
  return { ctx, drawn };
}

const song: ShareSong = {
  id: 's1',
  title: 'T',
  artist: 'A',
  cover_url: null,
  lyrics_raw: null,
  lyrics_synced: null,
};

async function fitFor(blocks: LyricLine[], orientation: 'landscape' | 'portrait', extra?: { pinned?: number }) {
  const { ctx } = fakeContext();
  const canvas = { getContext: () => ctx, width: 0, height: 0 } as unknown as HTMLCanvasElement;
  return drawCard(canvas, song, '', 'scan', 'site', blocks, orientation, true, true, true, 'ja', extra);
}

test('window starts at the first selected line while everything fits', () => {
  assert.equal(lyricWindowStart([44, 44, 44], 283), 0);
  assert.equal(lyricWindowStart([], 283), 0);
});

test('window slides to the pinned line when that line would be cut off', () => {
  // Landscape fits five 67px blocks in 350px.
  const heights = Array.from({ length: 10 }, () => 67);
  assert.equal(lyricWindowStart(heights, 350, 9), 5);
  // A pinned line already inside the natural window never moves it.
  assert.equal(lyricWindowStart(heights, 350, 3), 0);
  // No pinned line keeps the historical behaviour: drop from the tail.
  assert.equal(lyricWindowStart(heights, 350, -1), 0);
});

test('portrait with translations reports the four lines it can actually draw', async () => {
  const blocks = Array.from({ length: 10 }, (_, i) => lyric(`line ${i + 1}`, i, `译 ${i + 1}`));
  const fit = await fitFor(blocks, 'portrait');
  assert.ok(fit);
  assert.equal(fit.total, 10);
  assert.equal(fit.rendered, 4);
  assert.deepEqual(fit.dropped.map((line) => line.index), [4, 5, 6, 7, 8, 9]);
});

test('pinning the shared line keeps it in the image instead of dropping it', async () => {
  const blocks = Array.from({ length: 10 }, (_, i) => lyric(`line ${i + 1}`, i, `译 ${i + 1}`));
  const fit = await fitFor(blocks, 'portrait', { pinned: 8 });
  assert.ok(fit);
  assert.equal(fit.rendered, 4);
  assert.ok(!fit.dropped.some((line) => line.index === 8), 'the pinned line survived');
  assert.deepEqual(fit.dropped.map((line) => line.index), [0, 1, 2, 3, 4, 9]);
});

test('landscape holds five translated lines, one more than portrait', async () => {
  const blocks = Array.from({ length: 10 }, (_, i) => lyric(`line ${i + 1}`, i, `译 ${i + 1}`));
  const fit = await fitFor(blocks, 'landscape');
  assert.ok(fit);
  assert.equal(fit.rendered, 5);
  assert.deepEqual(fit.dropped.map((line) => line.index), [5, 6, 7, 8, 9]);
});

test('without translations the same card fits more lines and drops none silently', async () => {
  const blocks = Array.from({ length: 6 }, (_, i) => lyric(`line ${i + 1}`, i, null));
  const fit = await fitFor(blocks, 'portrait');
  assert.ok(fit);
  assert.equal(fit.rendered, 6);
  assert.equal(fit.dropped.length, 0);
});

test('an empty selection reports an empty, non-alarming fit', async () => {
  const fit = await fitFor([], 'landscape');
  assert.deepEqual(fit, { rendered: 0, total: 0, dropped: [] });
});
