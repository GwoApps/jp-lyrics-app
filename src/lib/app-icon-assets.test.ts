import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { APP_ICON_COLOR, APP_ICON_PATH, APP_ICON_VIEW_BOX } from './app-icon.ts';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
const purple = [1, 3, 5].map(start => parseInt(APP_ICON_COLOR.slice(start, start + 2), 16));
async function pixels(input: Buffer) {
  return sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

async function assertTransparentGlyph(input: Buffer, size: number) {
  const { data, info } = await pixels(input);
  assert.equal(info.width, size);
  assert.equal(info.height, size);
  assert.equal(info.channels, 4);
  let transparent = 0;
  let opaqueGlyph = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) transparent += 1;
    if (data[i + 3] === 255) {
      assert.deepEqual([...data.subarray(i, i + 3)], purple, 'opaque pixels are only the purple symbol, not a background');
      opaqueGlyph += 1;
    }
  }
  assert.ok(transparent > size * size / 2, 'majority of the favicon remains genuinely transparent');
  assert.ok(opaqueGlyph > 0, 'the icon has a visible solid foreground');
  // The upstream note flag intentionally reaches the top-right viewport edge;
  // that corner can contain antialiased purple ink, not a background tile.
  for (const [x, y] of [[0, 0], [0, size - 1], [size - 1, size - 1]]) {
    assert.equal(data[(y * size + x) * 4 + 3], 0);
  }
}

test('browser SVG and in-app mark use the exact pinned Material Symbols Outlined lyrics path', () => {
  const original = read('assets/branding/material-symbols-lyrics.svg').toString();
  const svg = read('public/icon.svg').toString();
  assert.equal(original.match(/<path d="([^"]+)"/)?.[1], APP_ICON_PATH);
  assert.ok(svg.includes(`viewBox="${APP_ICON_VIEW_BOX}"`));
  assert.ok(svg.includes(`fill="${APP_ICON_COLOR}"`));
  assert.ok(svg.includes(`d="${APP_ICON_PATH}"`));
  assert.doesNotMatch(svg, /<rect|<circle|<image|<style|<filter|<text|background/);
  const shell = read('src/components/AppShell.tsx').toString();
  assert.match(shell, /<AppIcon /);
  assert.doesNotMatch(shell, /Music2/);
  const component = read('src/components/AppIcon.tsx').toString();
  assert.match(component, /<path d=\{APP_ICON_PATH\}/);
  assert.match(component, /fill=\{APP_ICON_COLOR\}/);
});

for (const size of [16, 32]) {
  test(`browser ${size}px PNG is a transparent purple glyph without an opaque tile`, async () => {
    await assertTransparentGlyph(read(`public/icon-${size}x${size}.png`), size);
  });
}

test('all six ICO entries are complete transparent PNG frames at their declared sizes', async () => {
  const ico = read('src/app/favicon.ico');
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 6);
  const sizes: number[] = [];
  let offset = 6 + 6 * 16;
  for (let i = 0; i < 6; i += 1) {
    const at = 6 + i * 16;
    const size = ico[at] || 256;
    sizes.push(size);
    assert.equal(ico[at + 1] || 256, size);
    assert.equal(ico.readUInt16LE(at + 4), 1);
    assert.equal(ico.readUInt16LE(at + 6), 32);
    assert.equal(ico.readUInt32LE(at + 12), offset);
    const length = ico.readUInt32LE(at + 8);
    const png = ico.subarray(offset, offset + length);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    await assertTransparentGlyph(png, size);
    offset += length;
  }
  assert.deepEqual(sizes, [16, 32, 48, 64, 128, 256]);
  assert.equal(offset, ico.length);
});

test('standard PWA icons have their own dark rounded surfaces, not browser-favicon assets', async () => {
  for (const size of [192, 512]) {
    const { data, info } = await pixels(read(`public/icon-${size}x${size}.png`));
    assert.equal(info.width, size);
    assert.equal(info.height, size);
    assert.equal(data[3], 0, 'standard desktop PWA tile has rounded transparent corners');
    const at = Math.floor(size / 2) * 4;
    assert.deepEqual([...data.subarray(at, at + 4)], [20, 20, 20, 255], 'top-center tile is opaque dark card color');
    assert.ok(data.some((value, index) => index % 4 === 0 && value === purple[0] && data[index + 1] === purple[1] && data[index + 2] === purple[2]));
  }
});

test('Apple touch icon is an opaque 180px square and leaves corner masking to the platform', async () => {
  const { data, info } = await pixels(read('public/apple-touch-icon.png'));
  assert.equal(info.width, 180);
  assert.equal(info.height, 180);
  assert.deepEqual([...data.subarray(0, 4)], [20, 20, 20, 255]);
  for (let i = 3; i < data.length; i += 4) assert.equal(data[i], 255);
});

test('Android maskable icon is opaque and all visible purple stays in the circular 40-percent safe zone', async () => {
  const { data, info } = await pixels(read('public/icon-maskable-512x512.png'));
  assert.equal(info.width, 512);
  assert.equal(info.height, 512);
  let foreground = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const at: number = (y * info.width + x) * 4;
      assert.equal(data[at + 3], 255);
      if (data[at + 2] - data[at] > 5 && data[at + 2] - data[at + 1] > 10) {
        foreground += 1;
        assert.ok(Math.hypot(x + .5 - info.width / 2, y + .5 - info.height / 2) <= info.width * .4, 'foreground must survive every platform mask');
      }
    }
  }
  assert.ok(foreground > 0);
});
