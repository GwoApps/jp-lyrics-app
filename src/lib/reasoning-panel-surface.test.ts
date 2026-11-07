import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const overlay = readFileSync(new URL('../components/TranslationStatusOverlay.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

test('reasoning header and body share an opaque theme-card surface above the color texture', () => {
  const inner = overlay.match(/className="reasoning-glow(?:\s[^"\n]*)?"\s*>\s*<div className="([^"]+)"/);
  assert.ok(inner, 'reasoning panel has one inner surface wrapping header and body');
  assert.ok(inner[1].split(/\s+/).includes('bg-[var(--card)]'), 'inner surface uses the opaque card token without alpha');
  assert.doesNotMatch(inner[1], /bg-\[var\(--card\)\]\/|backdrop-blur|opacity-/);
  const darkCard = css.match(/:root\s*\{[^}]*--card:\s*([^;]+);/)?.[1]?.trim();
  assert.match(darkCard ?? '', /^#[\da-fA-F]{6}$/, 'dark card token is an opaque color');
});

test('reasoning border animation and external halo remain independently rendered', () => {
  for (const name of ['reasoning-glow-aura', 'reasoning-glow-ring', 'reasoning-glow-spin']) {
    assert.ok(overlay.includes(`className="${name}"`));
  }
  assert.match(css, /\.reasoning-glow::before\s*\{[^}]*conic-gradient\(/);
  assert.match(css, /\.reasoning-glow-aura\s*\{[^}]*filter:\s*blur\(36px\)/);
});
