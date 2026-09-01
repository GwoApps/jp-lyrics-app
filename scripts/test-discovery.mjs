import { readdir } from 'node:fs/promises';
import path from 'node:path';

const TEST_FILE_RE = /\.test\.(?:[cm]?[jt]sx?)$/;
const SKIP_DIRS = new Set([
  '.git',
  '.next',
  '.open-next',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
]);

export async function discoverTestFiles(root = process.cwd()) {
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile() && TEST_FILE_RE.test(entry.name)) {
        files.push(path.relative(root, absolutePath));
      }
    }
  }

  await visit(root);
  return files;
}
