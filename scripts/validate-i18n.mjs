#!/usr/bin/env node
/**
 * Static i18n key validation.
 *
 * Checks:
 *  1. The four locale dictionaries (ja/en/zh-CN/zh-TW) expose the exact same
 *     key sets, so translations never silently fall back to another language.
 *  2. Every key a source file *references* resolves in the dictionaries:
 *     - literal arguments, including ternary and `??` branches:
 *       `t('ns.key')`, `t('ns.key', { done, total })`, `t(a ? 'ns.x' : 'ns.y')`
 *     - template keys, wherever the template appears — inline
 *       (``t(`${ns}.save`)``) or built into a variable first
 *       (``const key = `admin.${code}`; t(key)``). Each template must be
 *       claimed by a DYNAMIC_KEY_TEMPLATES rule, and each rule derives the
 *       concrete keys from the code that produces its variable part (a union
 *       type, a schema, a lookup table) instead of a hand-kept list.
 *
 * ISSUE #358: the edit page shipped a save button rendering the raw key
 * `edit.save`. The previous check only matched `t('literal')` — the closing
 * paren was required — so template keys were never inspected, and the missing
 * `new.save`/`edit.save` entries sailed through. Now no template escapes the
 * registry, and every key an enumeration produces must exist in the reference
 * dictionary.
 *
 * Exit code 0 on success, 1 on any violation.
 */
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const LOCALES = ['ja', 'en', 'zh-CN', 'zh-TW'];
const DICT_DIR = ['src', 'i18n'];
const SRC_DIR = 'src';

function loadDictionaries(root) {
  const dicts = {};
  for (const locale of LOCALES) {
    dicts[locale] = JSON.parse(readFileSync(join(root, ...DICT_DIR, `${locale}.json`), 'utf8'));
  }
  return dicts;
}

/** Flat `namespace.key` set for a single dictionary. */
export function keySet(dict) {
  const keys = new Set();
  for (const [namespace, values] of Object.entries(dict)) {
    for (const key of Object.keys(values)) keys.add(`${namespace}.${key}`);
  }
  return keys;
}

async function collectSourceFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
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

const isIdentifierChar = (char) => char !== undefined && /[\w$]/.test(char);

/**
 * Source text of the first argument of every `t(…)` call. Arguments are cut at
 * a depth-0 comma while skipping string/template literal bodies, so nested
 * calls (`t(a ? 'b' : 'c')`) and object arguments (`t('a.b', { x })`) split
 * correctly.
 */
export function tCallArguments(source) {
  const args = [];
  for (const match of source.matchAll(/\bt\s*\(/g)) {
    // `\bt` still matches a `$`-prefixed identifier; skip those.
    if (isIdentifierChar(source[match.index - 1])) continue;
    let index = match.index + match[0].length;
    const start = index;
    let depth = 0;
    while (index < source.length) {
      const char = source[index];
      if (char === '(' || char === '[' || char === '{') depth += 1;
      else if (char === ')' || char === ']' || char === '}') {
        if (depth === 0) break;
        depth -= 1;
      } else if (depth === 0 && char === ',') break;
      else if (char === "'" || char === '"' || char === '`') {
        index += 1;
        while (index < source.length && source[index] !== char) index += source[index] === '\\' ? 2 : 1;
      }
      index += 1;
    }
    args.push(source.slice(start, index));
  }
  return args;
}

/**
 * Every template literal in `source`, with comments and string bodies skipped
 * so a key mentioned in prose (`// e.g. `admin.${code}``) is not a reference.
 */
export function templateLiterals(source) {
  const templates = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '/' && source[index + 1] === '/') {
      index = source.indexOf('\n', index);
      if (index === -1) break;
    } else if (char === '/' && source[index + 1] === '*') {
      index = source.indexOf('*/', index + 2);
      if (index === -1) break;
      index += 2;
    } else if (char === "'" || char === '"') {
      index += 1;
      while (index < source.length && source[index] !== char) index += source[index] === '\\' ? 2 : 1;
      index += 1;
    } else if (char === '`') {
      const start = index + 1;
      index += 1;
      while (index < source.length && source[index] !== '`') index += source[index] === '\\' ? 2 : 1;
      templates.push(source.slice(start, index));
      index += 1;
    } else {
      index += 1;
    }
  }
  return templates;
}

const KEY_LITERAL_RE = /^([A-Za-z]\w*)\.[A-Za-z]\w*$/;

/**
 * Whether a template literal is shaped like an i18n key:
 *   - `song.${x}` / `admin.${y}` — starts with a real namespace, or
 *   - `` `${ns}.save` `` — starts with the interpolated namespace and carries a
 *     literal identifier suffix.
 * Prose, URL and token templates (`${index + 1}. ${label}`, `https://a.b/${x}`,
 * `${body}.${signature}`) match neither shape.
 */
function isKeyTemplate(template, namespaces) {
  const segments = template.split('.');
  if (segments.length < 2) return false;
  const LITERAL_IDENTIFIER = /^[A-Za-z]\w*$/;
  if (namespaces.has(segments[0])) return true;
  return /^\$\{[A-Za-z_$][\w$]*\}$/.test(segments[0]) && segments.slice(1).some((segment) => LITERAL_IDENTIFIER.test(segment));
}

const STRING_LITERAL_RE = /(['"])((?:[^'"\\\n]|\\.)*)\1/g;

/** Quoted literals inside `text`. */
function stringLiterals(text) {
  return [...text.matchAll(STRING_LITERAL_RE)].map((match) => match[2]);
}

/** Keys named by string literals in a `t()` argument (ternary branches too). */
export function referencedLiteralKeys(argument, namespaces) {
  return stringLiterals(argument).filter((key) => KEY_LITERAL_RE.test(key) && namespaces.has(key.split('.')[0]));
}

/**
 * Dynamic key templates. A template is only as safe as the enumeration behind
 * it, so every template found in source must match exactly one rule here — a
 * new dynamic key is a CI failure until its producer is enumerated. Each rule
 * derives the concrete keys from the code that produces the variable part
 * (a union type, a schema, a lookup table) rather than a hand-kept list that
 * drifts. An enumeration that stops matching reports zero keys and fails.
 */
const DYNAMIC_KEY_TEMPLATES = [
  {
    template: /^\$\{ns\}\.[A-Za-z]\w*$/,
    describe: 'SongForm `${ns}.suffix`',
    // `ns` is the component prop `ns: 'new' | 'edit'`.
    keys: ({ groupLiterals, templates }) => [...new Set(templates
      .filter((template) => /^\$\{ns\}\.[A-Za-z]\w*$/.test(template))
      .flatMap((template) => groupLiterals('components/SongForm.tsx', /\bns:\s*([^;\n]+);/)
        .flatMap((ns) => template.replace('${ns}', ns))))],
  },
  {
    template: /^song\.\$\{key\}Cleared$/,
    describe: 'edit page `${key}Cleared` toast',
    // `key: SubDataKey` — the sub-data the edit page can clear server-side.
    keys: ({ groupLiterals }) => groupLiterals('app/songs/[id]/edit/page.tsx', /type SubDataKey\s*=\s*([^;]+);/)
      .map((key) => `song.${key}Cleared`),
  },
  {
    template: /^song\.\$\{STAGE_KEYS\[stage\]/,
    describe: 'sync overlay `song.${STAGE_KEYS[stage]}`',
    // STAGE_KEYS values plus the `?? 'syncing'` fallback.
    keys: ({ objectValues, capturedLiterals }) => [
      ...objectValues('components/SyncStatusOverlay.tsx', /const STAGE_KEYS[^=]*=\s*\{([\s\S]*?)\};/),
      ...capturedLiterals('components/SyncStatusOverlay.tsx', /\?\?\s*'([^']+)'\s*\}\)/g),
    ].map((key) => `song.${key}`),
  },
  {
    template: /^admin\.\$\{field\.(?:label_key|help_key|placeholder_key)\}$/,
    describe: 'builtin source_config field keys',
    // labelKey / helpKey / placeholderKey in the declarative schema.
    keys: ({ capturedLiterals }) => capturedLiterals(
      'lib/lyrics-provider/api-schema.ts',
      /(?:labelKey|helpKey|placeholderKey):\s*'([^']+)'/g,
    ).map((key) => `admin.${key}`),
  },
  {
    template: /^artistLibrary\.\$\{kind\}$/,
    describe: 'artist library quality kind',
    keys: ({ groupKeys }) => groupKeys('components/artists/artist-library-model.ts', /qualityFields\s*=\s*\{([\s\S]*?)\}/)
      .map((kind) => `artistLibrary.${kind}`),
  },
  {
    template: /^artistLibrary\.\$\{status\}$/,
    describe: 'artist library filter status',
    keys: ({ groupLiterals }) => groupLiterals('components/artists/ArtistLibraryControls.tsx', /\(\s*(\['all'[^\]]*\])/)
      .map((status) => `artistLibrary.${status}`),
  },
  {
    template: /^artistProfile\.\$\{error\}$/,
    describe: 'artist profile error code',
    // Server error codes mapped to suffixes, local validation codes, and the
    // readback failure the editor sets directly.
    keys: ({ groupLiterals, capturedLiterals }) => [
      ...groupLiterals('components/artists/ArtistProfileEditor.tsx', /const errorKeys[^=]*=\s*\{([\s\S]*?)\n\};/),
      ...capturedLiterals('components/artists/ArtistProfileEditor.tsx', /setError\('([^']+)'\)/g),
      ...capturedLiterals('components/artists/profile-presentation.ts', /\{\s*error:\s*'([^']+)'\s*\}/g),
    ].map((key) => `artistProfile.${key}`),
  },
  {
    template: /^artistProfile\.\$\{labels\[key\]\}$/,
    describe: 'artist profile cleared-field label',
    keys: ({ groupLiterals }) => groupLiterals('components/artists/ArtistProfileEditor.tsx', /const labels: Record<string, string> = \{([^}]*)\}/)
      .map((key) => `artistProfile.${key}`),
  },
  {
    template: /^artistProfile\.\$\{key\}$/,
    describe: 'artist profile source field label',
    keys: ({ groupLiterals }) => groupLiterals('components/artists/ArtistProfileHeader.tsx', /const fields: Record<string, string> = \{([^}]*)\}/)
      .map((key) => `artistProfile.${key}`),
  },
  {
    template: /^artistProfile\.\$\{kindKey\}$/,
    describe: 'artist profile kind label',
    keys: ({ capturedLiterals }) => capturedLiterals('components/artists/ArtistProfileHeader.tsx', /'(kind(?:Person|Group|Other))'/g)
      .map((key) => `artistProfile.${key}`),
  },
];

const ruleFor = (template) => DYNAMIC_KEY_TEMPLATES.find((rule) => rule.template.test(template));

/**
 * Run every check against `root`. Returns the violations as strings; the
 * caller decides how to report them (CLI exit code, assertion message, …).
 */
export async function validateI18n(root = ROOT, { log = () => {} } = {}) {
  const violations = [];
  const fail = (message) => violations.push(message);
  /** Log the phase summary only when the phases so far are clean. */
  const logIfClean = (checkpoint, line) => {
    if (violations.length === checkpoint) log(line);
  };

  const dicts = loadDictionaries(root);
  const reference = keySet(dicts.ja);
  const namespaces = new Set(Object.keys(dicts.ja));

  log(`  ✓ ${LOCALES.length} dictionaries loaded (${reference.size} keys each)`);
  for (const locale of LOCALES) {
    const keys = keySet(dicts[locale]);
    const missing = [...reference].filter((key) => !keys.has(key)).sort();
    const extra = [...keys].filter((key) => !reference.has(key)).sort();
    if (missing.length) fail(`${locale}.json missing keys: ${missing.join(', ')}`);
    if (extra.length) fail(`${locale}.json has extra keys: ${extra.join(', ')}`);
  }

  const literalCheckpoint = violations.length;
  const sourceDir = join(root, SRC_DIR);
  const files = await collectSourceFiles(sourceDir);
  const literalRefs = new Map();
  const templates = new Set();
  for (const file of files) {
    const relative = file.slice(sourceDir.length + 1);
    const source = readFileSync(file, 'utf8');
    for (const argument of tCallArguments(source)) {
      for (const key of referencedLiteralKeys(argument, namespaces)) {
        if (!literalRefs.has(key)) literalRefs.set(key, relative);
      }
    }
    // Scan templates file-wide, not just the ones handed to t(): building the
    // key into a variable first leaks the raw identifier just the same. Tests
    // are skipped — they stub t() and ship no user-visible copy.
    if (/\.test\.tsx?$/.test(relative)) continue;
    for (const template of templateLiterals(source)) {
      if (template.includes('${') && isKeyTemplate(template, namespaces)) templates.add(template);
    }
  }

  for (const [key, file] of literalRefs) {
    if (!reference.has(key)) fail(`src/${file}: missing translation key "${key}"`);
  }
  logIfClean(literalCheckpoint, `  ✓ ${literalRefs.size} literal t() keys resolve`);

  // Resolve every dynamic family, and refuse templates nobody registered.
  const helpers = {
    groupLiterals: (relativePath, pattern) => {
      const match = readFileSync(join(sourceDir, relativePath), 'utf8').match(pattern);
      return match ? stringLiterals(match[1]) : [];
    },
    /** Values of an object literal captured by group 1 (keys may be quoted). */
    objectValues: (relativePath, pattern) => {
      const match = readFileSync(join(sourceDir, relativePath), 'utf8').match(pattern);
      return match ? [...match[1].matchAll(/:\s*'([^']+)'/g)].map((entry) => entry[1]) : [];
    },
    capturedLiterals: (relativePath, pattern) => [
      ...readFileSync(join(sourceDir, relativePath), 'utf8').matchAll(pattern),
    ].map((match) => match[1]),
    groupKeys: (relativePath, pattern) => {
      const match = readFileSync(join(sourceDir, relativePath), 'utf8').match(pattern);
      return match ? [...match[1].matchAll(/(\w+)\s*:/g)].map((entry) => entry[1]) : [];
    },
  };

  const familyCheckpoint = violations.length;
  const resolvedRules = new Map();
  for (const template of templates) {
    const rule = ruleFor(template);
    if (!rule) {
      fail(`unregistered dynamic key template \`${template}\` — add a DYNAMIC_KEY_TEMPLATES entry in scripts/validate-i18n.mjs`);
      continue;
    }
    if (resolvedRules.has(rule)) continue;
    const keys = rule.keys({ ...helpers, templates: [...templates] });
    resolvedRules.set(rule, keys);
    if (keys.length === 0) {
      fail(`${rule.describe}: enumeration produced no keys — its source derivation no longer matches`);
      continue;
    }
    for (const key of keys) {
      if (!reference.has(key)) fail(`${rule.describe}: missing translation key "${key}"`);
    }
  }
  logIfClean(familyCheckpoint, `  ✓ ${templates.size} dynamic templates resolve through ${resolvedRules.size} registered enumerations`);

  return violations;
}

async function main() {
  console.log('Validating i18n keys…');
  const violations = await validateI18n(ROOT, { log: (line) => console.log(line) });
  if (violations.length > 0) {
    for (const violation of violations) console.error(`  ✗ ${violation}`);
    console.error(`\ni18n validation failed with ${violations.length} error(s).`);
    process.exit(1);
  }
  console.log('i18n validation passed.');
}

// Only run as a CLI, so tests can import the validators.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
