import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LOCALES,
  referencedLiteralKeys,
  tCallArguments,
  validateI18n,
} from './validate-i18n.mjs';

/**
 * Issue #358: the edit page rendered the raw key `edit.save` in all four
 * locales. The cause was the validator's scope, not the missing string, so
 * these tests pin the two halves that failed: `t()` arguments carrying a
 * second parameter, and template keys such as ``t(`${ns}.save`)``.
 */

const ROOT = new URL('..', import.meta.url).pathname;

/** Build a throwaway project: four dictionaries plus the source under test. */
async function fixture({ dictionaries, files }) {
  const dir = await mkdtemp(join(tmpdir(), 'i18n-validate-'));
  await mkdir(join(dir, 'src', 'i18n'), { recursive: true });
  for (const locale of LOCALES) {
    await writeFile(join(dir, 'src', 'i18n', `${locale}.json`), JSON.stringify(dictionaries[locale] ?? dictionaries.ja));
  }
  for (const [path, source] of Object.entries(files)) {
    await mkdir(join(dir, 'src', path, '..'), { recursive: true });
    await writeFile(join(dir, 'src', path), source);
  }
  return dir;
}

/** The dictionary every fake locale shares unless a test overrides one. */
const dict = { common: { save: 'Save' }, new: { save: 'Save' }, edit: { save: 'Save' } };
const identical = Object.fromEntries(LOCALES.map((locale) => [locale, dict]));

/** Minimal stand-in for src/components/SongForm.tsx, the `${ns}` key family. */
const songForm = (template) => `
interface SongFormProps {
  ns: 'new' | 'edit';
}
export function SongForm({ ns }: SongFormProps) {
  const t = (key: string) => key;
  return t(\`${template}\`);
}
`;

test('the repository itself validates clean', async () => {
  assert.deepEqual(await validateI18n(ROOT), []);
});

test('t() first arguments are cut at the depth-0 comma, ignoring nesting', () => {
  const source = `
    t('a.one');
    t('a.two', { done, total });
    t(flag ? 'a.three' : 'a.four');
    t(\`\${ns}.five\`, { count: t('a.six') });
    dict.t('a.method');
  `;
  assert.deepEqual(tCallArguments(source), [
    "'a.one'",
    "'a.two'",
    "flag ? 'a.three' : 'a.four'",
    '`${ns}.five`',
    "'a.six'", // a nested call is visited as its own t() call
    "'a.method'", // `dict.t(…)` also matches; its argument never looks like a key
  ]);
});

test('key-like string literals are read from a t() argument', () => {
  const namespaces = new Set(['a', 'song']);
  assert.deepEqual(
    referencedLiteralKeys("flag ? 'a.one' : 'song.two'", namespaces),
    ['a.one', 'song.two'],
  );
  // Non-key strings (raw text, codes, single words) are not keys.
  assert.deepEqual(referencedLiteralKeys("'—' ?? 'yue-jyutping'", namespaces), []);

});

test('a key referenced with a parameter object is validated (previously ignored)', async () => {
  const files = { 'app/page.tsx': `const label = t('new.save', { done: 1, total: 2 });` };
  const dir = await fixture({ dictionaries: identical, files });
  const withoutSave = Object.fromEntries(LOCALES.map((locale) => [locale, { ...dict, new: {} }]));
  const broken = await fixture({ dictionaries: withoutSave, files });
  try {
    assert.deepEqual(await validateI18n(dir), []);
    assert.match((await validateI18n(broken)).join('\n'), /missing translation key "new\.save"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(broken, { recursive: true, force: true });
  }
});

test('a missing template key fails and names the exact key', async () => {
  const withoutEdit = Object.fromEntries(LOCALES.map((locale) => [locale, { ...dict, edit: {} }]));
  const dir = await fixture({
    dictionaries: withoutEdit,
    files: { 'components/SongForm.tsx': songForm('${ns}.save') },
  });
  try {
    const violations = await validateI18n(dir);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /edit\.save/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an unregistered template fails even when the key is built outside t()', async () => {
  // `const key = `admin.${code}`; t(key)` leaks the raw identifier exactly like
  // an inline template, so the scan must not be limited to t() arguments.
  const withAdmin = Object.fromEntries(LOCALES.map((locale) => [locale, { ...dict, admin: { title: 'Admin' } }]));
  const dir = await fixture({
    dictionaries: withAdmin,
    files: { 'app/page.tsx': 'const key = `admin.${code}`;\nconst label = t(key);' },
  });
  try {
    const violations = await validateI18n(dir);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /unregistered dynamic key template `admin\.\$\{code\}`/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('templates that only look like keys are ignored', async () => {
  const dir = await fixture({
    dictionaries: identical,
    files: {
      'lib/format.ts': [
        'const url = `https://api.example.com/v1?q=${encodeURIComponent(q)}`;',
        'const line = `${index + 1}. ${label}`;',
        'const token = `${body}.${signature}`;',
        'const home = `/songs/${id}`;',
        '// a comment mentioning `admin.${code}` is not a reference',
        'const prose = "t(`common.${whatever}`)";',
      ].join('\n'),
    },
  });
  try {
    assert.deepEqual(await validateI18n(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a registered template whose enumeration stops matching fails loudly', async () => {
  // Same template, but the `ns` union the enumeration reads is gone.
  const dir = await fixture({
    dictionaries: identical,
    files: { 'components/SongForm.tsx': 'const x = t(`${ns}.save`);' },
  });
  try {
    const violations = await validateI18n(dir);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /produced no keys/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('locale dictionaries must stay in sync', async () => {
  const dir = await fixture({
    dictionaries: { ...identical, 'zh-TW': { ...dict, common: { save: '儲存', extra: '多餘' } } },
    files: {},
  });
  try {
    const violations = (await validateI18n(dir)).join('\n');
    assert.match(violations, /zh-TW\.json has extra keys: common\.extra/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
