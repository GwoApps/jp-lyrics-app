import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Issue #274: the UI font must follow the language setting, so the shell text,
 * buttons and editors lead with the CJK family that matches the active locale
 * instead of always leading with `Noto Sans JP`.
 *
 * The cascade itself is CSS, so this test asserts the contract that
 * `I18nProvider` relies on: `<html lang>` is mirrored from the locale, and
 * `globals.css` re-fonts `html[lang=…]` for every locale the app can switch to.
 * It also pins the ordering that keeps Traditional Chinese and lyric-level
 * overrides from losing the cascade, and the precedence of `[lang]` over `html[lang]`.
 */
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '..', 'app', 'globals.css'), 'utf8');
const i18nSource = readFileSync(join(here, 'i18n.tsx'), 'utf8');

/**
 * Font stack declared for `selector`, using the *last* declaration so the test
 * checks what actually wins the cascade (equal specificity → source order).
 * `selector` must appear at the start of a line, which is how every rule in
 * `globals.css` is written; comments never match, so they cannot shadow a rule.
 */
function fontStackFor(selector: string): string | null {
  // Selector lists may span lines (`html[lang^="zh-TW"],\nhtml[lang^="zh-HK"], … {`),
  // so the declaration block may start after further selector lines. `\\{` is
  // matched lazily to the FIRST brace, and `[^{}]*` keeps the body from spilling
  // into the next rule, so a selector that has no font-family of its own
  // (`body`) cannot borrow the declaration from the rule after it.
  const declarations = [
    ...css.matchAll(new RegExp(`^${escapeRegExp(selector)}(?:[^{}]*\n)?[^{}]*\\{[^}]*?font-family\\s*:\\s*([^;]+);`, 'gm')),
  ];
  const last = declarations.at(-1);
  return last ? last[1].trim() : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('every locale the switcher offers has a matching <html lang> font rule', () => {
  const locales = [...i18nSource.matchAll(/^\s*'?(ja|en|zh-CN|zh-TW)'?:\s*\{\s*label/gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(locales)].sort(), ['en', 'ja', 'zh-CN', 'zh-TW']);

  for (const locale of locales) {
    const stack = fontStackFor(`html[lang="${locale}"]`) ?? fontStackFor('html[lang^="zh"]');
    assert.ok(stack, `globals.css has no html[lang] font rule covering locale ${locale}`);
  }
});

test('the app mirrors the active locale onto <html lang>', () => {
  assert.match(i18nSource, /document\.documentElement\.lang\s*=\s*locale/, 'I18nProvider must sync <html lang> with the locale');
});

test('UI font leads with the locale-matched CJK family, not Noto Sans JP', () => {
  const simplified = fontStackFor('html[lang^="zh"]')!;
  const traditional = fontStackFor('html[lang^="zh-TW"]')!;

  assert.match(simplified, /^'Inter',\s*'Noto Sans SC'/, `zh UI font should lead with Noto Sans SC, got: ${simplified}`);
  assert.match(traditional, /^'Inter',\s*'Noto Sans TC'/, `zh-TW UI font should lead with Noto Sans TC, got: ${traditional}`);
  // Japanese stays the JP stack (same family order as the historical default).
  assert.match(fontStackFor('html[lang="ja"]')!, /^'Inter',\s*'Noto Sans JP'/);
});

test('Traditional Chinese rules stay after the broad zh rule so they win the cascade', () => {
  const simplifiedAt = css.indexOf('html[lang^="zh"]');
  const traditionalAt = css.indexOf('html[lang^="zh-TW"]');
  assert.ok(simplifiedAt !== -1 && traditionalAt !== -1, 'expected both html[lang] rule groups');
  assert.ok(traditionalAt > simplifiedAt, 'html[lang^="zh-TW"] must come after html[lang^="zh"]');
});

test('lyric-level [lang] overrides come after html[lang] so a Dutch-language UI still re-fonts ja/zh lyrics', () => {
  const htmlAt = css.indexOf('html[lang="ja"]');
  const elementAt = css.indexOf('\n[lang="ja"]');
  assert.ok(htmlAt !== -1 && elementAt !== -1, 'expected both html[lang] and element [lang] rules');
  assert.ok(elementAt > htmlAt, 'element-level [lang] rules must follow the html[lang] UI rules');
});

test('`body` does not redeclare font-family, so the html[lang] UI font actually inherits', () => {
  // Regression guard: a `body { font-family: … }` rule overrides the inherited
  // value from <html>, which silently cancelled the whole UI-font feature (the
  // language-matched `html[lang]` rule had no visible effect on any element).
  assert.equal(fontStackFor('body'), null, 'body must inherit its font from html, not redeclare it');
});
