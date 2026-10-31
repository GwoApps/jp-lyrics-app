import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { APP_ICON_REVISION } from '@/lib/app-icon';

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
  `(${metadataDeclaration.initializer.getText(layoutAst)})`, { APP_ICON_REVISION },
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
  const written: string[] = [];
  let claimed = false;
  let skipped = false;
  runInNewContext(swSource, {
    URL,
    self: {
      location: { origin: 'https://lyrics.example' },
      addEventListener: (name: string, handler: (event: WorkerEvent) => void) => { handlers[name] = handler; },
      skipWaiting: () => { skipped = true; },
      clients: { claim: async () => { claimed = true; } },
    },
    caches: {
      open: async (name: string) => {
        opened.push(name);
        return {
          add: async (url: string) => {
            added.push(url);
            if (url === options.failPrecache) throw new Error('asset unavailable');
          },
          put: async (request: Request) => { written.push(request.url); },
        };
      },
      keys: async () => options.cacheKeys ?? [],
      delete: async (name: string) => { deleted.push(name); return true; },
      match: async () => options.cached,
    },
    fetch: async () => {
      if (options.offline) throw new Error('offline');
      return options.response ?? new Response('network');
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
  assert.deepEqual(sw.opened, ['jplrc-v6']);
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

test('SW v6 activation removes old general caches but preserves immutable and kuromoji data', async () => {
  const sw = worker({ cacheKeys: ['jplrc-v4', 'jplrc-v5', 'jplrc-v6', 'jplrc-immutable-v1', 'jplrc-kuromoji-v1'] });
  await sw.lifecycle('activate');
  assert.deepEqual(sw.deleted, ['jplrc-v4', 'jplrc-v5']);
  assert.equal(sw.claimed, true);
});

test('SW still never persists personalized no-store song responses', async () => {
  for (const path of ['/api/songs?mine=1', '/api/songs/song-1']) {
    const response = new Response('personalized', { headers: { 'Cache-Control': 'private, no-store' } });
    const sw = worker({ response });
    assert.equal(await sw.fetch(path), response);
    assert.deepEqual(sw.written, []);
    assert.deepEqual(sw.opened, []);
  }
});

test('SW retains song offline fallback, network-only other APIs and long-lived asset caches', async () => {
  const cached = new Response('offline song');
  const offline = worker({ cached, offline: true });
  assert.equal(await offline.fetch('/api/songs/song-1'), cached);
  assert.equal(await offline.fetch('/api/me'), undefined);
  for (const [path, cache] of [
    ['/_next/static/chunk.js', 'jplrc-immutable-v1'],
    ['https://code4fukui.github.io/kuromoji-es/dict.dat', 'jplrc-kuromoji-v1'],
    ['/api/songs/song-1', 'jplrc-v6'],
  ]) {
    const sw = worker();
    assert.equal(await (await sw.fetch(path))?.text(), 'network');
    assert.deepEqual(sw.opened, [cache]);
    assert.equal(sw.written.length, 1);
  }
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
