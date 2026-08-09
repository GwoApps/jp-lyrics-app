#!/usr/bin/env node
/**
 * Static i18n key validation.
 *
 * Checks:
 *  1. The four locale dictionaries (ja/en/zh-CN/zh-TW) expose the exact same
 *     key sets, so translations never silently fall back to another language.
 *  2. Every literal `t('ns.key')` / `t("ns.key")` call in the source is present
 *     in the dictionaries — this catches keys referenced by code but missing
 *     from *all* dictionaries (e.g. a mistyped or never-added translation).
 *
 * Dynamic calls such as `t(\`${ns}.saved\`)` are intentionally ignored: the
 * script only guards static literals.
 *
 * Exit code 0 on success, 1 on any violation.
 */
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = ['ja', 'en', 'zh-CN', 'zh-TW'];
const DICT_DIR = join(ROOT, 'src', 'i18n');
const SRC_DIR = join(ROOT, 'src');

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`  ✗ ${msg}`);
};

function loadDictionaries() {
  const dicts = {};
  for (const locale of LOCALES) {
    const file = join(DICT_DIR, `${locale}.json`);
    dicts[locale] = JSON.parse(readFileSync(file, 'utf8'));
  }
  return dicts;
}

function keySet(dict) {
  const keys = new Set();
  for (const [ns, values] of Object.entries(dict)) {
    for (const key of Object.keys(values)) {
      keys.add(`${ns}.${key}`);
    }
  }
  return keys;
}

async function collectSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      files.push(...(await collectSourceFiles(full)));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      files.push(full);
    }
  }
  return files;
}

// Extract literal string arguments to t() calls: t('a.b'), t("a.b")
const LITERAL_KEY_RE = /\bt\(\s*(['"])([^'"\n]+)\1\s*\)/g;

function extractLiteralKeys(source) {
  const keys = new Set();
  for (const match of source.matchAll(LITERAL_KEY_RE)) {
    keys.add(match[2]);
  }
  return keys;
}

async function main() {
  console.log('Validating i18n keys…');

  // 1. Load dictionaries and compare key sets.
  const dicts = loadDictionaries();
  const keySets = new Map(LOCALES.map((locale) => [locale, keySet(dicts[locale])]));
  const reference = keySets.get('ja');

  console.log('  Checking locale dictionaries are in sync…');
  for (const locale of LOCALES) {
    const keys = keySets.get(locale);
    const missing = [...reference].filter((k) => !keys.has(k)).sort();
    const extra = [...keys].filter((k) => !reference.has(k)).sort();
    if (missing.length) fail(`${locale}.json missing keys: ${missing.join(', ')}`);
    if (extra.length) fail(`${locale}.json has extra keys: ${extra.join(', ')}`);
  }
  if (failures === 0) {
    console.log(`  ✓ All ${LOCALES.length} dictionaries share ${reference.size} keys`);
  }

  // 2. Check every literal t() key exists in the reference dictionary.
  console.log('  Checking literal t() keys referenced in source…');
  const files = await collectSourceFiles(SRC_DIR);
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const key of extractLiteralKeys(source)) {
      if (!reference.has(key)) {
        fail(`${file.replace(ROOT + '/', '')}: missing translation key "${key}"`);
      }
    }
  }

  if (failures > 0) {
    console.error(`\ni18n validation failed with ${failures} error(s).`);
    process.exit(1);
  }
  console.log('  ✓ All literal t() keys resolve');
  console.log('i18n validation passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
