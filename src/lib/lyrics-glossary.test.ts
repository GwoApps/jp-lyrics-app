/**
 * Terminology table states and write validation (issue #341).
 *
 * The column is injected into the system prompt of every later translation as
 * a hard constraint, so its states must be distinguishable ("never extracted",
 * "extraction failed", "no terms", "damaged") and its writes bounded.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GLOSSARY_MAX_ENTRIES,
  GLOSSARY_MAX_LENGTH,
  applyManualPins,
  hasAutoGlossaryEntries,
  hasGlossaryEntries,
  manualGlossaryEntries,
  mergeGlossaryEntries,
  needsGlossaryExtraction,
  parseLyricsGlossary,
  validateGlossaryInput,
} from './lyrics-glossary.ts';
import { buildSongUpdateSet } from './song-update.ts';
import { hasDerivedLyricsCaches } from './lyrics-content.ts';

test('NULL, "null", "[]" and entries are four different states', () => {
  assert.equal(parseLyricsGlossary(null).state, 'absent');
  assert.equal(parseLyricsGlossary(undefined).state, 'absent');
  assert.equal(parseLyricsGlossary('').state, 'absent');
  assert.equal(parseLyricsGlossary('null').state, 'failed');

  const empty = parseLyricsGlossary('[]');
  assert.equal(empty.state, 'ok');
  assert.deepEqual(empty.entries, []);

  const full = parseLyricsGlossary(JSON.stringify([{ original: '花火', translation: '烟花' }]));
  assert.equal(full.state, 'ok');
  assert.deepEqual(full.entries, [{ original: '花火', translation: '烟花' }]);
});

test('damaged and non-array values are reported instead of silently reading as empty', () => {
  for (const raw of ['not json', '{"a":1}', '"string"', '42']) {
    assert.equal(parseLyricsGlossary(raw).state, 'damaged', raw);
  }
  // Malformed members are dropped, not fatal.
  const mixed = parseLyricsGlossary(JSON.stringify([{ original: 'A', translation: 'B' }, { original: 1 }, null]));
  assert.equal(mixed.state, 'ok');
  assert.deepEqual(mixed.entries, [{ original: 'A', translation: 'B' }]);
});

test('the failed-extraction marker does not count as data worth warning about', () => {
  assert.equal(hasGlossaryEntries(null), false);
  assert.equal(hasGlossaryEntries('[]'), false);
  assert.equal(hasGlossaryEntries('null'), false);
  assert.equal(hasGlossaryEntries(JSON.stringify([{ original: 'A', translation: 'B' }])), true);
  // Damaged data is still stored content — a lyrics change does destroy it.
  assert.equal(hasGlossaryEntries('{oops'), true);
});

test('submitted glossaries are trimmed, bounded and duplicate-checked', () => {
  // Validation trims but never sets `manual`: pinning is resolved against the
  // stored table (see applyManualPins), not trusted from the client.
  assert.deepEqual(validateGlossaryInput([{ original: '  花火 ', translation: ' 烟花 ' }]), {
    ok: true,
    entries: [{ original: '花火', translation: '烟花' }],
  });

  assert.deepEqual(validateGlossaryInput('nope'), { ok: false, error: 'invalid_glossary' });
  assert.deepEqual(
    validateGlossaryInput(Array.from({ length: GLOSSARY_MAX_ENTRIES + 1 }, (_, i) => ({ original: `t${i}`, translation: `x${i}` }))),
    { ok: false, error: 'glossary_too_long' },
  );
  assert.deepEqual(validateGlossaryInput([{ original: ' ', translation: 'x' }]), { ok: false, error: 'glossary_entry_invalid' });
  assert.deepEqual(
    validateGlossaryInput([{ original: 'a'.repeat(GLOSSARY_MAX_LENGTH + 1), translation: 'x' }]),
    { ok: false, error: 'glossary_entry_too_long' },
  );
  assert.deepEqual(
    validateGlossaryInput([{ original: '花火', translation: '烟花' }, { original: '花火', translation: '焰火' }]),
    { ok: false, error: 'glossary_duplicate' },
  );
});

test('only new or corrected terms are pinned; passing a term through is not a correction', () => {
  const stored = JSON.stringify([
    { original: '花火', translation: '烟花' },
    { original: '君', translation: '你' },
  ]);
  const pinned = applyManualPins(
    [
      { original: '花火', translation: '烟花' }, // unchanged → stays auto
      { original: '君', translation: '妳' },     // corrected → pinned
      { original: '夜', translation: '夜' },     // new → pinned
    ],
    stored,
  );
  assert.deepEqual(pinned, [
    { original: '花火', translation: '烟花' },
    { original: '君', translation: '妳', manual: true },
    { original: '夜', translation: '夜', manual: true },
  ]);

  // A client-supplied `manual` flag is not trusted.
  const forged = applyManualPins([{ original: '花火', translation: '烟花', manual: true }], stored);
  assert.deepEqual(forged, [{ original: '花火', translation: '烟花' }]);

  // An already-pinned entry stays pinned even when submitted unchanged.
  const alreadyPinned = applyManualPins(
    [{ original: '君', translation: '你' }],
    JSON.stringify([{ original: '君', translation: '你', manual: true }]),
  );
  assert.deepEqual(alreadyPinned, [{ original: '君', translation: '你', manual: true }]);
});

test('a hand-edited glossary survives a same-request lyrics edit', () => {
  const set = buildSongUpdateSet(
    { lyrics_raw: 'old', lyrics_synced: '' },
    { lyrics_raw: 'new', lyrics_glossary: [{ original: '花火', translation: '烟花', manual: true }] },
  );
  assert.equal(set.lyricsGlossary, JSON.stringify([{ original: '花火', translation: '烟花', manual: true }]));
});

test('a lyrics edit drops auto-extracted terms but keeps hand-written ones', () => {
  const stored = JSON.stringify([
    { original: '花火', translation: '烟花' },
    { original: '君', translation: '你', manual: true },
  ]);
  const set = buildSongUpdateSet({ lyrics_raw: 'old', lyrics_synced: '', lyrics_glossary: stored }, { lyrics_raw: 'new' });
  const value = set.lyricsGlossary as { queryChunks?: unknown[] };
  assert.ok(value, 'glossary column participates in the update');
  const serialized = JSON.stringify(value.queryChunks ?? value);
  assert.match(serialized, /君/);
  assert.doesNotMatch(serialized, /花火/);
});

test('manualGlossaryEntries isolates what survives a lyrics change', () => {
  const stored = JSON.stringify([
    { original: '花火', translation: '烟花' },
    { original: '君', translation: '你', manual: true },
  ]);
  assert.deepEqual(manualGlossaryEntries(stored), [{ original: '君', translation: '你', manual: true }]);
  assert.deepEqual(manualGlossaryEntries('null'), []);
  assert.deepEqual(manualGlossaryEntries(null), []);
});

test('without a submitted glossary a lyrics edit still invalidates the derived table', () => {
  const set = buildSongUpdateSet({ lyrics_raw: 'old', lyrics_synced: '' }, { lyrics_raw: 'new' });
  assert.notEqual(typeof set.lyricsGlossary, 'string');
});

test('an explicit null glossary clears the column', () => {
  const set = buildSongUpdateSet({ lyrics_raw: 'old', lyrics_synced: '' }, { lyrics_glossary: null });
  assert.equal(set.lyricsGlossary, null);
});

test('hand-pinned terms win over a fresh extraction and the cap still holds', () => {
  const manual = [{ original: '花火', translation: '烟花', manual: true as const }];
  const merged = mergeGlossaryEntries(manual, [
    // The same term with the WRONG rendering: the pin must not be overwritten.
    { original: '花火', translation: '焰火' },
    { original: '君', translation: '你' },
  ]);
  assert.deepEqual(merged, [
    { original: '花火', translation: '烟花', manual: true },
    { original: '君', translation: '你' },
  ]);

  const many = Array.from({ length: GLOSSARY_MAX_ENTRIES + 5 }, (_, i) => ({ original: `t${i}`, translation: `x${i}` }));
  assert.equal(mergeGlossaryEntries(many.slice(0, 2), many).length, GLOSSARY_MAX_ENTRIES);
});

test('only states that genuinely need an extraction run trigger one', () => {
  const manualOnly = { state: 'ok' as const, entries: [{ original: '花火', translation: '烟花', manual: true }] };
  assert.equal(needsGlossaryExtraction({ state: 'absent', entries: [] }), true);
  assert.equal(needsGlossaryExtraction({ state: 'failed', entries: [] }), true);
  // A lyrics edit leaves exactly this state behind → the new text deserves its
  // own extraction.
  assert.equal(needsGlossaryExtraction(manualOnly), true);
  // "Extracted, no terms" is a real answer and must not re-run forever.
  assert.equal(needsGlossaryExtraction({ state: 'ok', entries: [] }), false);
  assert.equal(needsGlossaryExtraction({ state: 'ok', entries: [{ original: 'A', translation: 'B' }] }), false);
  // An unreadable value must not pin the song to "no terminology" forever.
  assert.equal(needsGlossaryExtraction({ state: 'damaged', entries: [] }), true);
});

test('a lyrics change only counts as "losing caches" when auto terms actually die', () => {
  const pinned = JSON.stringify([{ original: '花火', translation: '烟花', manual: true }]);
  const auto = JSON.stringify([{ original: '花火', translation: '烟花' }]);
  assert.equal(hasAutoGlossaryEntries(pinned), false);
  assert.equal(hasAutoGlossaryEntries(auto), true);
  assert.equal(hasAutoGlossaryEntries('[]'), false);
  assert.equal(hasAutoGlossaryEntries('null'), false);
  // Unreadable data still counts — a lyrics change does destroy it.
  assert.equal(hasAutoGlossaryEntries('{oops'), true);

  assert.equal(hasDerivedLyricsCaches({ glossary: pinned }), false);
  assert.equal(hasDerivedLyricsCaches({ glossary: auto }), true);
});
