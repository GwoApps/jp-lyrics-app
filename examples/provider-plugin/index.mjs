/**
 * Minimal reference HTTP lyrics provider plugin (jplrc-lyrics-provider v1).
 *
 * Serves the fixed endpoints over a plain Node http server:
 *   GET  {base_url}/manifest.json
 *   POST {base_url}/v1/search
 *
 * It only retrieves candidates — scoring, LRC parsing, review and persistence
 * are owned by jplrc. Run with:
 *   node examples/provider-plugin/index.mjs [--port 8787] [--token "secret"]
 *
 * With `--token`, the /v1/search endpoint requires `Authorization: Bearer <token>`.
 * When deployed behind HTTPS with a path prefix (e.g.
 * https://example.com/providers/lrclib-proxy), the app proxies this server.
 */
import { createServer } from 'node:http';

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8787);
const TOKEN = process.env.PROVIDER_TOKEN ?? null;

const MANIFEST = {
  protocol: 'jplrc-lyrics-provider',
  protocol_version: 1,
  id: 'example-provider',
  name: 'Example Lyrics',
  version: '1.0.0',
  capabilities: ['search', 'plain', 'synced'],
  limits: { max_candidates: 10 },
};

/** A tiny in-memory lyric catalog keyed by title (lowercased, trimmed). */
const CATALOG = new Map([
  ['残酷天使的行动纲领', {
    title: '残酷天使的行动纲领',
    artists: ['高桥洋子'],
    album: '残酷天使的行动纲领',
    duration_ms: 263000,
    plain: '像残酷天使的行动纲领\n少年啊 变成神话吧',
    synced: '[00:05.00]像残酷天使的行动纲领\n[00:12.00]少年啊 变成神话吧',
    source_url: 'https://example.com/song/1',
  }],
  ['きらきら星', {
    title: 'きらきら星',
    artists: ['テスト歌手'],
    album: '童謡集',
    duration_ms: 96000,
    plain: 'きらきら光る\nお空の星よ',
    synced: '',
    source_url: 'https://example.com/song/2',
  }],
]);

function normalize(value) {
  return String(value ?? '').toLowerCase().trim();
}

function handleSearch(req, res, body) {
  // Optional bearer auth.
  if (TOKEN) {
    const auth = req.headers.authorization ?? '';
    if (auth !== `Bearer ${TOKEN}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'auth_failed', message: 'missing or invalid bearer token' } }));
      return;
    }
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'invalid_request', message: 'malformed JSON' } }));
    return;
  }

  if (payload.protocol_version !== 1) {
    res.writeHead(422, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'invalid_request', message: 'unsupported protocol_version' } }));
    return;
  }

  const track = payload.track ?? {};
  const key = normalize(track.title);
  const match = CATALOG.get(key);
  const candidates = match
    ? [{ candidate_id: `opaque-${key}`, ...match }]
    : [];

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    protocol_version: 1,
    request_id: payload.request_id ?? null,
    candidates,
  }));
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (req.method === 'GET' && url.pathname.endsWith('/manifest.json')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(MANIFEST));
    return;
  }

  if (req.method === 'POST' && url.pathname.endsWith('/v1/search')) {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => handleSearch(req, res, body));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { code: 'not_found', message: 'unknown endpoint' } }));
});

server.listen(PORT, () => {
  console.log(`Example lyrics provider listening on http://localhost:${PORT}`);
  console.log(`manifest: http://localhost:${PORT}/manifest.json`);
  console.log(`search:   http://localhost:${PORT}/v1/search`);
  if (TOKEN) console.log('bearer auth enabled');
});
