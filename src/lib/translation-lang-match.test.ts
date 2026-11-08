import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { translationLangState } from './translation-lang-match.ts';
import { isLanguageTag } from './target-lang.ts';

// issue #281: the client must decide "is the cached translation the language I
// asked for?" with exactly the rule the translate route already applies —
// otherwise the badge ("已翻译 N/N") and the next request disagree.

test('a recorded language that differs from the target language is a mismatch', () => {
  const state = translationLangState('zh-CN', 'en-US', true);
  assert.equal(state.mismatch, true);
  assert.equal(state.storedLang, 'zh-CN');
  assert.equal(state.targetLang, 'en-US');
  assert.equal(state.lang, 'zh-CN');
});

test('matching languages are not a mismatch', () => {
  assert.equal(translationLangState('zh-TW', 'zh-TW', true).mismatch, false);
  // Admin-configured custom languages compare like any other tag.
  assert.equal(translationLangState('pt-BR', 'pt-BR', true).mismatch, false);
  assert.equal(translationLangState('pt-BR', 'en-US', true).mismatch, true);
});

test('no cache means no mismatch, whatever the stamps say', () => {
  assert.equal(translationLangState('zh-CN', 'en-US', false).mismatch, false);
});

test('an unrecorded or pending language never counts as a mismatch', () => {
  // Legacy rows / manual corrections predate the stamp; they are unlabelled,
  // not wrong. The settings lookup is also async — during the first render
  // there is no target yet, and the page must not flash a warning.
  assert.equal(translationLangState(null, 'en-US', true).mismatch, false);
  assert.equal(translationLangState('', 'en-US', true).mismatch, false);
  assert.equal(translationLangState('   ', 'en-US', true).mismatch, false);
  assert.equal(translationLangState('zh-CN', null, true).mismatch, false);
  assert.equal(translationLangState('zh-CN', '', true).mismatch, false);
});

test('malformed stamps are a data problem, not a language mismatch', () => {
  assert.equal(translationLangState('zh_CN', 'en-US', true).mismatch, false);
  assert.equal(translationLangState('zh-CN', 'not a lang', true).mismatch, false);
});

test('the stored tag is normalized for the lang attribute', () => {
  assert.equal(translationLangState('ZH-hant-tw', 'en-US', true).lang, 'zh-Hant-TW');
  // Unusable values fall back to the rendering default instead of leaking.
  assert.equal(translationLangState('garbage', 'en-US', true).lang, 'zh-CN');
});

test('isLanguageTag accepts custom targets but rejects junk', () => {
  for (const code of ['zh-CN', 'en', 'pt-BR', 'yue', 'ZH-hant-tw']) {
    assert.equal(isLanguageTag(code), true, code);
  }
  for (const code of ['', '  ', 'zh_CN', '1zh', 'a', null, undefined]) {
    assert.equal(isLanguageTag(code), false, String(code));
  }
});

test('every surface asks the same helper instead of re-deriving the rule', () => {
  // The bug was three surfaces each deciding for themselves (or not at all).
  for (const path of [
    '../hooks/useTranslation.ts',
    '../app/songs/[id]/share/page.tsx',
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /from '@\/lib\/translation-lang-match'/, `${path} does not use the shared check`);
  }
  const dialog = readFileSync(new URL('../components/song/DownloadDialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /translationLangMismatch/, 'the export dialog cannot warn about the cached language');
});

test('the translation entries no longer hardcode Chinese', () => {
  for (const locale of ['zh-CN', 'zh-TW', 'ja', 'en']) {
    const dict = JSON.parse(readFileSync(new URL(`../i18n/${locale}.json`, import.meta.url), 'utf8'));
    for (const [ns, key] of [['song', 'translation'], ['song', 'exportTranslationLabel'], ['share', 'includeTranslation']]) {
      const value: string = dict[ns][key];
      assert.doesNotMatch(value, /中文|中国語|Chinese/, `${locale}.json ${ns}.${key} still names Chinese: ${value}`);
    }
  }
});
