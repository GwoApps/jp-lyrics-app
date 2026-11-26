import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { APP_ICON_REVISION } from '@/lib/app-icon';
import { APP_NAME_NEUTRAL, APP_NAME_SHORT, APP_DESCRIPTION } from '@/lib/app-identity';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const layoutSource = read('src/app/layout.tsx');
const swSource = read('public/sw.js');
const composeSource = read('docker-compose.yml');
const manifest = JSON.parse(read('public/manifest.json')) as {
  id: string;
  start_url: string;
  scope: string;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
};
const versioned = (path: string) => `${path}?v=${APP_ICON_REVISION}`;
// Derived from the worker so bumping the cache version needs no test edit.
const cacheName = /const CACHE_NAME = '([^']+)'/.exec(swSource)?.[1];
assert.ok(cacheName, 'sw.js must declare CACHE_NAME');
const [cachePrefix, cacheVersion] = [cacheName.replace(/v\d+$/, ''), Number(/(\d+)$/.exec(cacheName)?.[1])];
const previousCaches = [cacheVersion - 2, cacheVersion - 1].map((version) => `${cachePrefix}v${version}`);
const baseIcons = [
  '/icon.svg', '/favicon.ico', '/icon-16x16.png', '/icon-32x32.png',
  '/icon-192x192.png', '/icon-512x512.png', '/icon-maskable-512x512.png', '/apple-touch-icon.png',
];

// Evaluate only the real metadata expression, without loading React, CSS or AppShell.
const layoutAst = ts.createSourceFile('layout.tsx', layoutSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const metadataDeclaration = layoutAst.statements
  .filter(ts.isVariableStatement)
  .flatMap((statement) => [...statement.declarationList.declarations])
  .find((declaration) => declaration.name.getText(layoutAst) === 'metadata');
assert.ok(metadataDeclaration?.initializer);
const metadata = JSON.parse(JSON.stringify(runInNewContext(
  `(${metadataDeclaration.initializer.getText(layoutAst)})`,
  { APP_ICON_REVISION, APP_NAME_NEUTRAL, APP_NAME_SHORT, APP_DESCRIPTION, configuredOrigin: null },
))) as {
  manifest: string;
  icons: {
    icon: { url: string; sizes: string; type: string }[];
    apple: { url: string; sizes: string; type: string }[];
    shortcut: string;
  };
};

function label(name: string): string {
  const line = composeSource.split('\n').find((entry) => entry.trim().startsWith(`- "${name}=`));
  assert.ok(line, `missing compose label ${name}`);
  return line.trim().slice(`- "${name}=`.length, -1);
}

interface WorkerEvent {
  request?: Request;
  waitUntil: (promise: Promise<unknown>) => void;
  respondWith: (promise: Promise<Response | undefined>) => void;
}

function worker(options: {
  cacheKeys?: string[];
  cached?: Response;
  response?: Response;
  offline?: boolean;
  failPrecache?: string;
} = {}) {
  const handlers: Record<string, (event: WorkerEvent) => void> = {};
  const added: string[] = [];
  const deleted: string[] = [];
  const opened: string[] = [];
  const written: { cache: string; url: string }[] = [];
  const stores = new Map<string, Map<string, Response>>();
  const responseHeaders = options.response?.headers;
  let claimed = false;
  let skipped = false;
  runInNewContext(swSource, {
    URL,
    Request,
    Response,
    console,
    self: {
      location: { origin: 'https://lyrics.example' },
      addEventListener: (name: string, handler: (event: WorkerEvent) => void) => { handlers[name] = handler; },
      skipWaiting: () => { skipped = true; },
      clients: { claim: async () => { claimed = true; } },
    },
    caches: {
      open: async (name: string) => {
        opened.push(name);
        let store = stores.get(name);
        if (!store) { store = new Map(); stores.set(name, store); }
        return {
          add: async (url: string) => {
            added.push(url);
            if (url === options.failPrecache) throw new Error('asset unavailable');
          },
          put: async (request: Request | string, response: Response) => {
            const url = typeof request === 'string' ? request : request.url;
            written.push({ cache: name, url });
            store!.set(url, response);
          },
          match: async (request: Request | string) =>
            store!.get(typeof request === 'string' ? request : request.url),
        };
      },
      keys: async () => options.cacheKeys ?? [],
      delete: async (name: string) => { deleted.push(name); stores.delete(name); return true; },
      match: async (request: Request | string) => {
        const url = typeof request === 'string' ? request : request.url;
        for (const store of stores.values()) {
          const found = store.get(url);
          if (found) return found;
        }
        return options.cached ?? null;
      },
    },
    fetch: async () => {
      if (options.offline) throw new Error('offline');
      if (options.response) {
        const clone = options.response.clone();
        const headers = new Headers(responseHeaders);
        if (!headers.has('X-Offline-Identity')) headers.set('X-Offline-Identity', 'anon');
        return new Response(await clone.arrayBuffer(), {
          status: options.response.status,
          statusText: options.response.statusText,
          headers,
        });
      }
      return new Response('network');
    },
  });
  return {
    added, deleted, opened, written,
    get claimed() { return claimed; },
    get skipped() { return skipped; },
    async lifecycle(name: 'install' | 'activate') {
      const pending: Promise<unknown>[] = [];
      handlers[name]({ waitUntil: (promise) => { pending.push(promise); }, respondWith: () => {} });
      await Promise.all(pending);
    },
    async fetch(path: string) {
      let result: Promise<Response | undefined> | undefined;
      handlers.fetch({
        request: new Request(new URL(path, 'https://lyrics.example')),
        waitUntil: () => {},
        respondWith: (promise) => { result = promise; },
      });
      return result;
    },
    async message(data: unknown) {
      const pending: Promise<unknown>[] = [];
      handlers.message({
        data,
        waitUntil: (promise) => { pending.push(promise); },
        respondWith: () => {},
      } as WorkerEvent & { data: unknown });
      await Promise.all(pending);
    },
    seedSong(path: string, identity: string, body: string) {
      const url = new URL(path, 'https://lyrics.example').href;
      const key = `${url}${url.includes('?') ? '&' : '?'}__offline=${encodeURIComponent(identity)}`;
      let store = stores.get('jplrc-songs-v1');
      if (!store) { store = new Map(); stores.set('jplrc-songs-v1', store); }
      store.set(key, new Response(body));
    },
  };
}

test('browser icons use only transparent SVG and small PNGs, with the shared revision', () => {
  assert.equal(APP_ICON_REVISION, 'lyrics-v1');
  assert.match(layoutSource, /import\s*\{\s*APP_ICON_REVISION\s*\}\s*from\s*'@\/lib\/app-icon'/);
  assert.deepEqual(metadata.icons.icon, [
    { url: versioned('/icon.svg'), sizes: 'any', type: 'image/svg+xml' },
    { url: versioned('/icon-16x16.png'), sizes: '16x16', type: 'image/png' },
    { url: versioned('/icon-32x32.png'), sizes: '32x32', type: 'image/png' },
  ]);
  assert.equal(metadata.icons.shortcut, versioned('/favicon.ico'));
  // The automatic Next.js favicon route still has its source file.
  assert.ok(readFileSync(new URL('../app/favicon.ico', import.meta.url)).length > 0);
});

test('Apple touch is a separate versioned 180px icon', () => {
  assert.deepEqual(metadata.icons.apple, [
    { url: versioned('/apple-touch-icon.png'), sizes: '180x180', type: 'image/png' },
  ]);
});

test('PWA manifest contains only install-size any/maskable assets and preserves app identity', () => {
  assert.equal(metadata.manifest, '/manifest.json');
  assert.deepEqual([manifest.id, manifest.start_url, manifest.scope], ['/', '/', '/']);
  assert.deepEqual(manifest.icons, [
    { src: versioned('/icon-192x192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: versioned('/icon-512x512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: versioned('/icon-maskable-512x512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ]);
});

test('SW precaches base icons, favicon and every versioned integration URL', async () => {
  const sw = worker();
  await sw.lifecycle('install');
  assert.equal(sw.skipped, true);
  assert.deepEqual(sw.opened, [cacheName]);
  assert.deepEqual(new Set(sw.added), new Set([...baseIcons, ...baseIcons.map(versioned), '/manifest.json']));
  const usedUrls = [
    ...metadata.icons.icon.map((icon) => icon.url),
    ...metadata.icons.apple.map((icon) => icon.url),
    metadata.icons.shortcut,
    ...manifest.icons.map((icon) => icon.src),
  ];
  for (const url of usedUrls) assert.ok(sw.added.includes(url), `${url} must be precached`);
});

test('one missing precache asset does not prevent installing the remaining icons', async () => {
  const sw = worker({ failPrecache: '/favicon.ico' });
  await sw.lifecycle('install');
  assert.ok(sw.added.includes(versioned('/icon.svg')));
  assert.ok(sw.added.includes(versioned('/apple-touch-icon.png')));
});

test('SW activation removes old general caches but preserves immutable and kuromoji data', async () => {
  const sw = worker({ cacheKeys: [...previousCaches, cacheName, 'jplrc-immutable-v1', 'jplrc-kuromoji-v1'] });
  await sw.lifecycle('activate');
  assert.deepEqual(sw.deleted, previousCaches);
  assert.equal(sw.claimed, true);
});

test('SW stores no-store song payloads only under the identity-scoped cache', async () => {
  for (const path of ['/api/songs?mine=1', '/api/songs/song-1']) {
    const response = new Response('personalized', {
      headers: { 'Cache-Control': 'private, no-store', 'X-Offline-Identity': 'u-account-a' },
    });
    const sw = worker({ response });
    assert.equal((await sw.fetch(path))?.headers.get('Cache-Control'), 'private, no-store');
    // No identity marker has been synced yet, so the response is served but
    // not written — the worker refuses to guess which account it belongs to.
    assert.deepEqual(sw.written, []);
  }
});

test('SW retains song offline fallback, network-only other APIs and long-lived asset caches', async () => {
  const cached = new Response('offline song');
  const offline = worker({ cached, offline: true });
  // Without a synced identity the worker cannot serve a song snapshot offline.
  await assert.rejects(() => offline.fetch('/api/songs/song-1'));
  assert.equal(await offline.fetch('/api/me'), undefined);
  for (const [path, cache] of [
    ['/_next/static/chunk.js', 'jplrc-immutable-v1'],
    ['https://code4fukui.github.io/kuromoji-es/dict.dat', 'jplrc-kuromoji-v1'],
  ]) {
    const sw = worker();
    assert.equal(await (await sw.fetch(path))?.text(), 'network');
    assert.deepEqual(sw.opened, [cache]);
    assert.equal(sw.written.length, 1);
  }
});

test('SW caches a song under its identity and serves it offline only for that identity', async () => {
  const sw = worker({
    response: new Response('my lyrics', {
      headers: { 'Cache-Control': 'private, no-store', 'X-Offline-Identity': 'u-alice' },
    }),
  });
  await sw.message({ type: 'OFFLINE_IDENTITY', identity: 'u-alice' });
  sw.written.length = 0;
  sw.opened.length = 0;
  const write = await sw.fetch('/api/songs/song-1');
  assert.equal(await write?.text(), 'my lyrics');
  // The identity-scoped copy is written via a fire-and-forget cache.put; give
  // it a microtask turn to land before asserting.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(sw.written, [
    { cache: 'jplrc-songs-v1', url: 'https://lyrics.example/api/songs/song-1?__offline=u-alice' },
  ]);

  // Offline: a worker synced to alice reads her snapshot; one synced to bob
  // (who has no copy) must not receive it.
  const alice = worker({ offline: true });
  await alice.message({ type: 'OFFLINE_IDENTITY', identity: 'u-alice' });
  alice.seedSong('/api/songs/song-1', 'u-alice', 'my lyrics');
  assert.equal(await (await alice.fetch('/api/songs/song-1'))?.text(), 'my lyrics');

  const bob = worker({ offline: true });
  await bob.message({ type: 'OFFLINE_IDENTITY', identity: 'u-bob' });
  bob.seedSong('/api/songs/song-1', 'u-alice', 'my lyrics');
  await assert.rejects(() => bob.fetch('/api/songs/song-1'));
});

test('SW drops all song snapshots when the account identity changes', async () => {
  const sw = worker({ cacheKeys: ['jplrc-songs-v1'] });
  await sw.message({ type: 'OFFLINE_IDENTITY', identity: 'u-bob' });
  assert.deepEqual(sw.deleted, ['jplrc-songs-v1']);
  assert.ok(sw.written.some((entry) => entry.url === '/__identity__'));
});

test('public router adds exact SVG/favicon paths, retains existing assets, and keeps app routes protected', () => {
  const rule = label('traefik.http.routers.jplrc-public.rule');
  assert.ok(rule.startsWith('Host(`${JPLRC_DOMAIN}`) && ('));
  const conditions = [...rule.matchAll(/(Path|PathPrefix)\(`([^`]+)`\)/g)]
    .map((match) => [match[1], match[2]]);
  assert.deepEqual(conditions, [
    ['Path', '/manifest.json'], ['Path', '/sw.js'], ['Path', '/icon.svg'], ['Path', '/favicon.ico'],
    ['PathPrefix', '/icon-'], ['Path', '/apple-touch-icon.png'],
  ]);
  const publiclyRouted = (path: string, host = 'lyrics.example') => runInNewContext(
    rule.replace('${JPLRC_DOMAIN}', 'lyrics.example'), {
      Host: (expected: string) => host === expected,
      Path: (expected: string) => new URL(path, 'https://lyrics.example').pathname === expected,
      PathPrefix: (prefix: string) => new URL(path, 'https://lyrics.example').pathname.startsWith(prefix),
    },
  );
  for (const path of [...baseIcons, ...baseIcons.map(versioned), '/manifest.json', '/sw.js']) {
    assert.equal(publiclyRouted(path), true, path);
    assert.equal(publiclyRouted(path, 'other.example'), false, path);
  }
  for (const path of ['/', '/songs/1', '/api/songs', '/icon.svg/extra', '/icon.svg.bak', '/favicon.ico/extra', '/favicon.ico.bak', '/icons/private']) {
    assert.equal(publiclyRouted(path), false, path);
  }
  assert.equal(label('traefik.http.routers.jplrc.rule'), 'Host(`${JPLRC_DOMAIN}`)');
  assert.equal(label('traefik.http.routers.jplrc.middlewares'), '${TRAEFIK_AUTH_MIDDLEWARE}');
  assert.equal(label('traefik.http.routers.jplrc-public.priority'), '100');
  assert.ok(!composeSource.includes('traefik.http.routers.jplrc-public.middlewares='));
});
