import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

// Static contracts only: browser/E2E and perceptual motion checks are opt-in.
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/songs/[id]/page.tsx', import.meta.url), 'utf8');
const player = readFileSync(new URL('../components/song/SongPlayer.tsx', import.meta.url), 'utf8');
const block = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^\\s*${escaped}\\s*\\{([^}]+)\\}`, 'm').exec(css);
  assert.ok(match, `missing CSS selector ${selector}`);
  return match[1];
};

test('player remains mounted for its exit while hidden controls are inert', () => {
  assert.match(page, /className="song-player-disclosure" data-expanded=\{playerExpanded\}/);
  assert.match(page, /aria-hidden=\{!playerExpanded\} inert=\{!playerExpanded\}/);
  assert.doesNotMatch(page, /playerExpanded && !immersive\.active/);
  assert.match(page, /<SongPlayer active=\{playerExpanded\}/);
});

test('accordion animates document flow so the following lyric panel moves in both directions', () => {
  assert.match(block('.song-player-disclosure'), /grid-template-rows: 0fr/);
  assert.match(block('.song-player-disclosure'), /transition: grid-template-rows/);
  assert.match(block('.song-player-disclosure[data-expanded="true"]'), /grid-template-rows: 1fr/);
  const clip = block('.song-player-disclosure__clip');
  assert.match(clip, /min-height: 0/);
  assert.match(clip, /overflow: hidden/);
});

test('card uses symmetric interruptible fade/translation transitions, not remount keyframes', () => {
  const closed = block('.song-player-disclosure .song-player');
  assert.match(closed, /opacity: 0/);
  assert.match(closed, /transform: translateY\(-6px\)/);
  assert.match(closed, /transition: opacity/);
  assert.match(closed, /transform var\(--song-player-motion-duration\)/);
  const open = block('.song-player-disclosure[data-expanded="true"] .song-player');
  assert.match(open, /opacity: 1/);
  assert.match(open, /transform: translateY\(0\)/);
  assert.doesNotMatch(closed + open, /animation:/);
  assert.match(css, /--song-player-motion-duration: 220ms/);
});

test('expanded desktop header gap matches the 12px gap below the player', () => {
  assert.match(css, /@media \(min-width: 640px\)\s*\{\s*\.song-detail-header/);
  assert.match(block('.song-view[data-player-expanded="true"] > .song-detail-header'), /margin-bottom: 12px/);
  assert.match(block('.song-player'), /margin-bottom: 12px/);
});

test('reduced motion disables reveal reflow and positional movement', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.song-player-disclosure, \.song-player-disclosure \.song-player, \.song-detail-header \{ transition: none; \}\s*\.song-player-disclosure \.song-player \{ transform: none; \}/);
});

test('retained hidden player does not run its display clock or accept operations', () => {
  assert.match(player, /if \(!active\) return;/);
  assert.match(player, /const disabled = !active \|\|/);
  assert.match(player, /\[active, playback, playing, duration, matching, playbackMsRef\]/);
});
