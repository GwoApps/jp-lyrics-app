import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TRANSLATION_LANG,
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
  assert.equal(targetLangDisplay('zh-TW'), '繁體中文');
  assert.equal(targetLangDisplay('pt-BR'), 'pt-BR');
  assert.equal(targetLangDisplay(null), '');
});
