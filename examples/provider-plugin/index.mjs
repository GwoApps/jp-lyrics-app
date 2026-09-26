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

const DEFAULT_PORT = 8787;

/**
 * Parse `[--port <n>] [--token <s>]` from argv, falling back to the PORT /
 * PROVIDER_TOKEN env vars and then to the defaults. A malformed flag is a hard
 * error: silently listening on a different port would look like a healthy
 * plugin while the admin panel's base URL never connects.
 */
function parseArgs(argv) {
  const options = { port: process.env.PORT ?? DEFAULT_PORT, token: process.env.PROVIDER_TOKEN ?? null };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag !== '--port' && flag !== '--token') {
      throw new Error(`unknown argument: ${flag} (usage: --port <n> --token <s>)`);
    }
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${flag} requires a value`);
    i += 1;
    if (flag === '--port') options.port = value;
    else options.token = value;
  }

  const port = Number(options.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid --port value: ${options.port} (expected an integer 0-65535)`);
  }
  return { port, token: options.token || null };
}

let PORT;
let TOKEN;
try {
  ({ port: PORT, token: TOKEN } = parseArgs(process.argv.slice(2)));
} catch (error) {
  console.error(`[example-provider] ${error.message}`);
  process.exit(1);
}

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
    plain_lyrics: '像残酷天使的行动纲领\n少年啊 变成神话吧',
    synced_lyrics: '[00:05.00]像残酷天使的行动纲领\n[00:12.00]少年啊 变成神话吧',
    source_url: 'https://example.com/song/1',
  }],
  ['きらきら星', {
    title: 'きらきら星',
    artists: ['テスト歌手'],
    album: '童謡集',
    duration_ms: 96000,
    plain_lyrics: 'きらきら光る\nお空の星よ',
    synced_lyrics: '',
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
