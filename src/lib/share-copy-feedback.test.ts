import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { load } from 'cheerio';

// The project's Node loader resolves .ts, not TSX. Execute the real, pure
// feedback component through the already-installed TypeScript compiler, with
// React's server renderer; this is not a browser/focus/animation timing test.
const code = readFileSync(new URL('../components/share/ShareCopyFeedback.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(code, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
}).outputText;
const componentModule: { default?: ComponentType<{ copied: boolean; label: string; copiedLabel: string; icon: ReturnType<typeof createElement> }> } = {};
new Function('require', 'exports', compiled)(createRequire(import.meta.url), componentModule);
const Feedback = componentModule.default!;

for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja']) {
  test(`copy feedback renders both localized lyric actions and only one accessible state in ${locale}`, () => {
    const dictionary = JSON.parse(readFileSync(new URL(`../i18n/${locale}.json`, import.meta.url), 'utf8'));
    for (const key of ['copyLyrics', 'copyLyricsWithTranslation']) {
      for (const copied of [false, true]) {
        const label: string = dictionary.share[key];
        const copiedLabel: string = dictionary.share.copied;
        const html = renderToStaticMarkup(createElement(Feedback, {
          copied, label, copiedLabel, icon: createElement('span', { 'data-test-copy-icon': '' }),
        }));
        const $ = load(html);
        assert.equal($('.share-copy-feedback').attr('data-copied'), String(copied));
        assert.equal($('.share-copy-feedback__state').length, 2);
        assert.equal($('.share-copy-feedback__state[aria-hidden="true"]').length, 2);
        assert.equal($('.share-copy-feedback__default').text(), label);
        assert.equal($('.share-copy-feedback__success').text(), copiedLabel);
        assert.equal($('[aria-live="polite"][aria-atomic="true"]').text(), copied ? copiedLabel : label);
        assert.equal($('[data-test-copy-icon]').length, 1);
      }
    }
  });
}
