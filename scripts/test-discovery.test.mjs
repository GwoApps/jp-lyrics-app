import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { discoverTestFiles } from './test-discovery.mjs';

test('discovers supported test files recursively and skips build directories', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'jplrc-test-discovery-'));
  try {
    await Promise.all([
      mkdir(path.join(root, 'src', 'feature'), { recursive: true }),
      mkdir(path.join(root, 'tests', 'integration'), { recursive: true }),
      mkdir(path.join(root, 'node_modules', 'ignored'), { recursive: true }),
      mkdir(path.join(root, '.next', 'ignored'), { recursive: true }),
      mkdir(path.join(root, 'coverage'), { recursive: true }),
      mkdir(path.join(root, 'dist'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(root, 'src', 'feature', 'nested.test.ts'), ''),
      writeFile(path.join(root, 'tests', 'integration', 'api.test.mjs'), ''),
      writeFile(path.join(root, 'src', 'feature', 'not-a-test.ts'), ''),
      writeFile(path.join(root, 'node_modules', 'ignored', 'dependency.test.js'), ''),
      writeFile(path.join(root, '.next', 'ignored', 'generated.test.js'), ''),
      writeFile(path.join(root, 'coverage', 'generated.test.js'), ''),
      writeFile(path.join(root, 'dist', 'generated.test.js'), ''),
    ]);

    assert.deepEqual(await discoverTestFiles(root), [
      path.join('src', 'feature', 'nested.test.ts'),
      path.join('tests', 'integration', 'api.test.mjs'),
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
