import { spawn } from 'node:child_process';
import process from 'node:process';
import { discoverTestFiles } from './test-discovery.mjs';

const testFiles = await discoverTestFiles();
if (testFiles.length === 0) {
  console.error('No test files found.');
  process.exit(1);
}

console.log(`Discovered ${testFiles.length} test files.`);
const args = [
  '--experimental-strip-types',
  '--experimental-loader',
  './scripts/test-loader.mjs',
  '--test',
  ...testFiles,
];
const child = spawn(process.execPath, args, { stdio: 'inherit' });
child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
