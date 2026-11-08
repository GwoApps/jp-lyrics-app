import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_TRANSLATION_LANG,
  TARGET_LANG_PRESETS,
  isKnownTargetLang,
  resolveTranslationLang,
  targetLangDisplay,
} from './target-lang.ts';

test('resolveTranslationLang keeps known target languages as-is', () => {
  // Every preset written by the translate pipeline must survive untouched.
  for (const { value } of [
    { value: 'zh-CN' },
    { value: 'zh-TW' },
    { value: 'zh-HK' },
    { value: 'en-US' },
  ]) {
    assert.equal(resolveTranslationLang(value), value);
  }
});

test('resolveTranslationLang normalizes casing to canonical BCP-47', () => {
  assert.equal(resolveTranslationLang('zh-cn'), 'zh-CN');
  assert.equal(resolveTranslationLang('  ZH-TW  '), 'zh-TW');
  assert.equal(resolveTranslationLang('ZH-hant-tw'), 'zh-Hant-TW');
  assert.equal(resolveTranslationLang('eN'), 'en');
  assert.equal(resolveTranslationLang('ja'), 'ja');
  // Language subtag lowercased, 3-digit region uppercased.
  assert.equal(resolveTranslationLang('ES-419'), 'es-419');
});

test('resolveTranslationLang falls back to the default for unusable values', () => {
  for (const value of [null, undefined, '', '   ', '"zh-CN"', 'zh_CN', 'zh CN', 'x', '1zh', 'garbage', 'zh-CN" onload="x']) {
    assert.equal(resolveTranslationLang(value), DEFAULT_TRANSLATION_LANG, `value ${JSON.stringify(value)}`);
  }
});

test('resolveTranslationLang prefers the stored value over the fallback', () => {
  assert.notEqual(resolveTranslationLang('zh-TW'), DEFAULT_TRANSLATION_LANG);
  assert.equal(DEFAULT_TRANSLATION_LANG, 'zh-CN');
});

test('existing preset helpers stay consistent', () => {
  assert.equal(isKnownTargetLang('zh-HK'), true);
  assert.equal(isKnownTargetLang('zh-hk'), false);
  assert.notEqual(targetLangDisplay('zh-TW'), 'zh-TW');
  assert.equal(targetLangDisplay('pt-BR'), 'pt-BR');
  assert.equal(targetLangDisplay(null), '');
});

test('preset labels are rendered as label plus the ISO code', () => {
  // issue #330: every surface goes through one formatting rule.
  for (const { value, label } of TARGET_LANG_PRESETS) {
    assert.equal(targetLangDisplay(value), `${label}（${value}）`);
  }
  // The code is what tells the variants apart, whatever the label says.
  assert.notEqual(targetLangDisplay('zh-TW'), targetLangDisplay('zh-HK'));
});

test('the two pickers use the shared preset list instead of local copies', () => {
  for (const path of ['../app/settings/page.tsx', '../components/admin/TranslationConfigPanel.tsx']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /const\s+TARGET_LANG_PRESETS\s*=/, `${path} redeclares TARGET_LANG_PRESETS`);
    assert.match(source, /from '@\/lib\/target-lang'/, `${path} does not import the shared presets`);
  }
});
