import assert from 'node:assert/strict';
import test from 'node:test';
import { coverTextContrast, readableCoverTextColor } from './cover-text-color.ts';
import type { CoverColor, CoverPalette } from './cover-color';

const allegro: CoverPalette = {
  primary: { r: 10, g: 13, b: 22 },
  secondary: { r: 110, g: 100, b: 151 },
  tertiary: { r: 184, g: 192, b: 206 },
};

function tintedBackground(base: CoverColor, primary: CoverColor): CoverColor {
  return {
    r: Math.round(base.r * .96 + primary.r * .04),
    g: Math.round(base.g * .96 + primary.g * .04),
    b: Math.round(base.b * .96 + primary.b * .04),
  };
}

test('Allegro uses a readable palette colour in dark mode without altering the source palette', () => {
  const snapshot = structuredClone(allegro);
  const dark = readableCoverTextColor(allegro, 'dark');
  assert.deepEqual(dark, allegro.tertiary);
  assert.ok(coverTextContrast(allegro.primary, { r: 10, g: 10, b: 10 }) < 1.1);
  assert.ok(coverTextContrast(dark, tintedBackground({ r: 10, g: 10, b: 10 }, allegro.primary)) >= 4.5);
  assert.deepEqual(allegro, snapshot);
});

test('light mode may use the original dark primary rather than the dark-mode text colour', () => {
  const light = readableCoverTextColor(allegro, 'light');
  assert.deepEqual(light, allegro.primary);
  assert.ok(coverTextContrast(light, tintedBackground({ r: 255, g: 255, b: 255 }, allegro.primary)) >= 4.5);
  assert.ok(coverTextContrast(allegro.tertiary, { r: 255, g: 255, b: 255 }) < 4.5);
});

test('if all sampled colours fail, adjust towards readable text in both themes', () => {
  const middle = { r: 120, g: 120, b: 120 };
  const palette = { primary: middle, secondary: middle, tertiary: middle };
  const dark = readableCoverTextColor(palette, 'dark');
  const light = readableCoverTextColor(palette, 'light');
  assert.ok(coverTextContrast(middle, tintedBackground({ r: 10, g: 10, b: 10 }, middle)) < 4.5);
  assert.ok(coverTextContrast(middle, tintedBackground({ r: 255, g: 255, b: 255 }, middle)) < 4.5);
  assert.ok(coverTextContrast(dark, tintedBackground({ r: 10, g: 10, b: 10 }, middle)) >= 4.5);
  assert.ok(coverTextContrast(light, tintedBackground({ r: 255, g: 255, b: 255 }, middle)) >= 4.5);
  assert.ok(dark.r > middle.r);
  assert.ok(light.r < middle.r);
});

test('prefer the first passing palette colour; keep vivid covers unchanged', () => {
  const purple = { r: 167, g: 139, b: 250 };
  const palette = { primary: purple, secondary: allegro.secondary, tertiary: allegro.tertiary };
  assert.deepEqual(readableCoverTextColor(palette, 'dark'), purple);
});
