import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Issue #280: the kuromoji tokenizer is a module-level singleton promise.
 *
 * Originally the promise was memoized on creation only, so once a load failed
 * (module import or the ~17MB dictionary download) the rejected promise was
 * returned forever: the UI "retry" button re-ran the effect, hit the same
 * promise and failed again with the same message — only a full page reload
 * could try again.
 *
 * The CDN load itself is unreachable from the test runner (and this repo has no
 * DOM test setup), so these tests exercise the memoization contract directly by
 * stubbing the shared `loadTokenizerFromCdn` seam.
 */
type Loader = () => Promise<unknown>;

interface TokenizerModule {
  getTokenizer: () => Promise<unknown>;
  resetTokenizer: () => void;
  __setTokenizerLoaderForTest: (loader: Loader) => void;
}

const mod = (await import('./kuroshiro-client.ts')) as unknown as TokenizerModule;
const { getTokenizer, resetTokenizer, __setTokenizerLoaderForTest } = mod;

function useLoader(loader: Loader): void {
  resetTokenizer();
  __setTokenizerLoaderForTest(loader);
}

test('a failed tokenizer load is not memoized: the next call retries', async () => {
  let attempts = 0;
  const tokenizer = { tokenize: () => [] };
  useLoader(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('dictionary download failed');
    return tokenizer;
  });

  await assert.rejects(getTokenizer(), /dictionary download failed/);
  assert.equal(attempts, 1);

  // Before the fix this returned the memoized rejection without calling the loader again.
  assert.equal(await getTokenizer(), tokenizer);
  assert.equal(attempts, 2, 'retry must start a new load attempt');
});

test('a successful tokenizer load is still cached across calls', async () => {
  let attempts = 0;
  const tokenizer = { tokenize: () => [] };
  useLoader(async () => {
    attempts += 1;
    return tokenizer;
  });

  assert.equal(await getTokenizer(), tokenizer);
  assert.equal(await getTokenizer(), tokenizer);
  assert.equal(attempts, 1, 'a loaded tokenizer must be cached, not reloaded');
});

test('concurrent calls share one in-flight load attempt', async () => {
  let attempts = 0;
  const tokenizer = { tokenize: () => [] };
  useLoader(async () => {
    attempts += 1;
    await Promise.resolve();
    return tokenizer;
  });

  const [first, second] = await Promise.all([getTokenizer(), getTokenizer()]);
  assert.equal(first, tokenizer);
  assert.equal(second, tokenizer);
  assert.equal(attempts, 1, 'parallel callers must not each download the dictionary');
});

test('a retry cleared by resetTokenizer drops even a successful memoized tokenizer', async () => {
  let attempts = 0;
  const tokenizer = { tokenize: () => [] };
  useLoader(async () => {
    attempts += 1;
    return tokenizer;
  });

  await getTokenizer();
  resetTokenizer();
  await getTokenizer();
  assert.equal(attempts, 2);
});

test.after(() => {
  // Leave the module with its real CDN loader so other suites see no stub.
  resetTokenizer();
});
