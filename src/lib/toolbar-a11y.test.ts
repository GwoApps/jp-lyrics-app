import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Issue #416: the desktop copy menu passed a ReactNode as `label` and the
// trigger wrote it straight into `aria-label`/`title`. React drops non-string
// attribute values silently, so the button had no accessible name at all.
test('toolbar menu trigger only exposes a string as its accessible name', () => {
  const menu = source('components/song/ToolbarMenu.tsx');
  const trigger = menu.slice(menu.indexOf('<DropdownMenuTrigger'));
  assert.match(trigger, /aria-label=\{triggerLabel\}/);
  assert.match(trigger, /title=\{triggerLabel\}/);
  // `label` stays visual-only in ToolbarMenu: it must never reach an attribute again.
  assert.doesNotMatch(trigger.slice(0, trigger.indexOf('>')), /aria-label=\{label\}|title=\{label\}/);
});

test('icon-only toolbar triggers and font-size buttons resolve a localized name', () => {
  for (const locale of ['ja', 'en', 'zh-CN', 'zh-TW']) {
    const song = JSON.parse(source(`i18n/${locale}.json`)).song;
    for (const key of ['copyLyrics', 'fontSizeDecrease', 'fontSizeIncrease']) {
      const value: string | undefined = song[key];
      assert.ok(value?.trim(), `${locale}.json song.${key} is missing`);
      assert.notEqual(value, `song.${key}`, `${locale}.json song.${key} leaks the raw key`);
    }
  }
  const page = source('app/songs/[id]/page.tsx');
  for (const key of ['song.copyLyrics', 'song.fontSizeDecrease', 'song.fontSizeIncrease']) {
    assert.ok(page.includes(`t('${key}')`), `page.tsx does not use ${key}`);
  }
});
