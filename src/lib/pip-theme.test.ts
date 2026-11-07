import test from 'node:test';
import assert from 'node:assert/strict';
import { PIP_PALETTES, pipPaletteVars } from './pip-theme.ts';
import { normalizePipThemeChoice, resolvePipTheme } from './settings-utils.ts';

test('resolvePipTheme: system follows the main theme, explicit wins', () => {
  assert.equal(resolvePipTheme('system', 'light'), 'light');
  assert.equal(resolvePipTheme('system', 'dark'), 'dark');
  assert.equal(resolvePipTheme('light', 'dark'), 'light');
  assert.equal(resolvePipTheme('dark', 'light'), 'dark');
  // Unset / unknown (e.g. a legacy value) falls back to following the main theme.
  assert.equal(resolvePipTheme(undefined, 'light'), 'light');
  assert.equal(resolvePipTheme('neon', 'dark'), 'dark');
});

test('normalizePipThemeChoice keeps only system/dark/light', () => {
  assert.equal(normalizePipThemeChoice('dark'), 'dark');
  assert.equal(normalizePipThemeChoice('light'), 'light');
  assert.equal(normalizePipThemeChoice('system'), 'system');
  assert.equal(normalizePipThemeChoice(undefined), 'system');
  assert.equal(normalizePipThemeChoice(''), 'system');
});

test('pipPaletteVars exposes one variable per palette entry and never hard-codes dark', () => {
  const dark = pipPaletteVars('dark');
  const light = pipPaletteVars('light');
  assert.deepEqual(Object.keys(light), Object.keys(dark));
  for (const name of Object.keys(dark)) assert.match(name, /^--pip-/);
  // The old bug: a light-themed user still got #0a0a0a. Every colour must differ.
  for (const [name, value] of Object.entries(dark)) {
    assert.notEqual(value, light[name], `${name} is identical in both palettes`);
  }
  assert.equal(light['--pip-bg'], '#ffffff');
  assert.equal(dark['--pip-bg'], '#0a0a0a');
});

test('palette colorScheme matches the palette it belongs to', () => {
  assert.equal(PIP_PALETTES.dark.colorScheme, 'dark');
  assert.equal(PIP_PALETTES.light.colorScheme, 'light');
});
