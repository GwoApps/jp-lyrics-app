/**
 * The language-stamp rule for partial saves (issue #394).
 *
 * The cache carries ONE language stamp for MANY lines, so the stamp may only
 * change to `targetLang` when every non-empty line really is in `targetLang`.
 * These cases pin the invariant "stamp L after writing L ⟹ every non-empty line
 * is in L": the user-visible consequences (mismatch banner, 「已翻译 N/N」,
 * whole-song cache short-circuit) all hang off it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideTranslationLangStamp,
  editedLineIndices,
  isMixedTranslationLang,
} from './translation-cache-lang.ts';

const LINES = ['one', 'two', 'three', 'four'];

/** A decision helper with the defaults every case shares (a user-driven save). */
function decide(opts: {
  merged: readonly string[];
  edits: { index: number }[];
  targetLang?: string | null;
  storedLang?: string | null;
  assumeStoredLang?: boolean;
}) {
  return decideTranslationLangStamp({
    merged: opts.merged,
    editedIndices: editedLineIndices(opts.edits),
    targetLang: opts.targetLang === undefined ? 'en' : opts.targetLang,
    storedLang: opts.storedLang ?? null,
    assumeStoredLang: opts.assumeStoredLang ?? true,
  });
}

test('a save that leaves old-language lines untouched keeps the old stamp', () => {
  // zh-CN cache, target switched to en, the user fixes one line and saves.
  const decision = decide({
    merged: ['中文一', '中文二', '中文三', 'fixed'],
    edits: [{ index: 3 }],
    targetLang: 'en',
    storedLang: 'zh-CN',
  });
  assert.deepEqual(decision, { stamp: false, reason: 'mixed' });
  assert.equal(isMixedTranslationLang('zh-CN', 'en'), true);
});

test('a save that covers every non-empty line may stamp the target language', () => {
  // e.g. AI fill + manual edits turned the whole cache into English.
  const decision = decide({
    merged: ['one', 'two', 'three', 'four'],
    edits: LINES.map((line, index) => ({ index })),
    targetLang: 'en',
    storedLang: 'zh-CN',
  });
  assert.deepEqual(decision, { stamp: 'en', reason: 'all_lines_stamped' });
  assert.equal(isMixedTranslationLang('en', 'en'), false);
});

test('blank source lines carry no language and never block the stamp', () => {
  // Lines 1 and 3 hold no translation at all: the user cleared line 1 (an edit
  // that writes '') and line 3 was never translated. Blank lines carry no
  // language, so nothing is left that still needs re-translating.
  const decision = decide({
    merged: ['one', '', 'two', ''],
    edits: [{ index: 0 }, { index: 1 }, { index: 2 }],
    targetLang: 'en',
    storedLang: 'zh-CN',
  });
  assert.deepEqual(decision, { stamp: 'en', reason: 'all_lines_stamped' });
  // An untouched line that DOES carry text blocks the stamp, blank neighbours
  // or not — this is the #394 case.
  assert.deepEqual(
    decide({ merged: ['one', '', '旧文', ''], edits: [{ index: 0 }], targetLang: 'en', storedLang: 'zh-CN' }),
    { stamp: false, reason: 'mixed' },
  );
});

test('a matching stored stamp is refreshed as-is (issue #189 stays fixed)', () => {
  const decision = decide({
    merged: ['一', '二改', '三', '四'],
    edits: [{ index: 1 }],
    targetLang: 'zh-CN',
    storedLang: 'zh-CN',
  });
  assert.deepEqual(decision, { stamp: 'zh-CN', reason: 'all_lines_stamped' });
});

test('stamp comparison normalises casing, like the renderer does', () => {
  const decision = decide({
    merged: ['一', '二改'],
    edits: [{ index: 1 }],
    targetLang: 'zh-Hant-TW',
    storedLang: 'ZH-hant-tw',
  });
  assert.deepEqual(decision, { stamp: 'zh-Hant-TW', reason: 'all_lines_stamped' });
  // …but the client's mismatch rule still needs real tags on both sides.
  assert.equal(isMixedTranslationLang('zh-Hant-TW', 'zh_hant_tw'), false);
});

test('an unrecorded stamp is trusted for untouched lines on a user-driven save', () => {
  // Legacy rows / earlier manual corrections are unlabelled, not wrong: the
  // user IS looking at those lines and saved from them, so #189's refresh
  // applies (otherwise their confirmed work keeps triggering re-translation).
  const decision = decide({
    merged: ['一', '二改', '三', '四'],
    edits: [{ index: 1 }],
    targetLang: 'en',
    storedLang: null,
  });
  assert.deepEqual(decision, { stamp: 'en', reason: 'all_lines_stamped' });
  // Blank (or whitespace-only) stored values stay unlabelled in the same way.
  assert.deepEqual(
    decide({ merged: ['a', 'b'], edits: [{ index: 0 }], targetLang: 'en', storedLang: '  ' }),
    { stamp: 'en', reason: 'all_lines_stamped' },
  );
});

test('an unrecorded stamp must NOT be invented when untouched lines prove nothing', () => {
  // Issue #394's other half: a differing stamp is visibly "mixed", but a BLANK
  // stamp is not — stamping it once would hide old-language lines for good.
  const decision = decide({
    merged: ['一', '二'],
    edits: [{ index: 1 }],
    targetLang: 'en',
    storedLang: null,
    assumeStoredLang: false,
  });
  assert.deepEqual(decision, { stamp: false, reason: 'unknown' });
  // Whatever is stored, lines an AI merge did not write here cannot be vouched
  // for — not even when the old stamp happens to name the target language — so
  // the stamp is only touched once every non-empty line is written by this save.
  assert.deepEqual(
    decide({ merged: ['一', '二'], edits: [{ index: 1 }], targetLang: 'en', storedLang: 'en', assumeStoredLang: false }),
    { stamp: false, reason: 'mixed' },
  );
  assert.deepEqual(
    decide({ merged: ['一', '二'], edits: [{ index: 0 }, { index: 1 }], targetLang: 'en', storedLang: null, assumeStoredLang: false }),
    { stamp: 'en', reason: 'all_lines_stamped' },
  );
});

test('an unusable stored stamp is never compared, and is corrected only when safe', () => {
  assert.deepEqual(
    decide({ merged: ['a', 'b'], edits: [{ index: 0 }], targetLang: 'en', storedLang: 'en_US' }),
    { stamp: false, reason: 'unknown' },
  );
  assert.deepEqual(
    decide({ merged: ['a', 'b'], edits: [{ index: 0 }, { index: 1 }], targetLang: 'en', storedLang: 'en_US' }),
    { stamp: 'en', reason: 'all_lines_stamped' },
  );
  // A malformed tag that merely RESOLVES to the same language (`en_US` → `en`)
  // is still unverified: it cannot speak for the untouched line, and it is
  // corrected only once every line has been written.
  assert.deepEqual(
    decide({ merged: ['一', '二'], edits: [{ index: 0 }], targetLang: 'en', storedLang: 'en_US' }),
    { stamp: false, reason: 'unknown' },
  );
});

test('an emptied cache clears the stamp instead of labelling nothing', () => {
  const decision = decide({
    merged: ['', '', '', ''],
    edits: LINES.map((line, index) => ({ index })),
    targetLang: 'en',
    storedLang: 'zh-CN',
  });
  assert.deepEqual(decision, { stamp: null, reason: 'empty_cache' });
  assert.equal(isMixedTranslationLang(null, 'en'), false);
});

test('no resolved target language means no fabricated stamp', () => {
  assert.deepEqual(
    decide({ merged: ['a', 'b'], edits: [{ index: 0 }], targetLang: null, storedLang: 'zh-CN' }),
    { stamp: false, reason: 'mixed' },
  );
  assert.deepEqual(
    decide({ merged: ['a', 'b'], edits: [{ index: 0 }], targetLang: '', storedLang: null }),
    { stamp: false, reason: 'unknown' },
  );
});

test('the mixed flag needs two real, different tags', () => {
  assert.equal(isMixedTranslationLang('zh-CN', 'en'), true);
  assert.equal(isMixedTranslationLang('zh-CN', 'zh-CN'), false);
  assert.equal(isMixedTranslationLang(null, 'en'), false);
  assert.equal(isMixedTranslationLang('', 'en'), false);
  assert.equal(isMixedTranslationLang('zh_CN', 'en'), false);
  assert.equal(isMixedTranslationLang('zh-CN', null), false);
});
