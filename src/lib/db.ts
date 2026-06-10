import { createClient, type Client } from '@libsql/client';

/**
 * Database client — @libsql/client (Turso / embedded SQLite).
 *
 * Env vars:
 *   TURSO_URL       — libsql://xxx.turso.io  (remote, edge-compatible)
 *   TURSO_AUTH_TOKEN — JWT auth token         (remote)
 *
 * With TURSO_URL:  pure HTTP client, zero filesystem dependency.
 *                  Compatible with Cloudflare Workers / Vercel Edge.
 * Without TURSO_URL: falls back to local file (data/local.db).
 *                    Requires Node.js runtime (Docker / self-hosted).
 */

const useRemote = !!process.env.TURSO_URL;

// Local file mode only: ensure data/ directory exists (Node.js runtime only)
if (!useRemote) {
  try {
    // Dynamic require so bundlers for edge runtimes can tree-shake fs away
    const fs = require('fs') as typeof import('fs');
    fs.mkdirSync('data', { recursive: true });
  } catch { /* already exists, or fs unavailable (edge) */ }
}

const client: Client = useRemote
  ? createClient({
      url: process.env.TURSO_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN,
    })
  : createClient({ url: 'file:data/local.db' });

// --- Schema bootstrap (runs once on first import) ---

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  lyrics_raw TEXT NOT NULL DEFAULT '',
  lyrics_furigana TEXT NOT NULL DEFAULT '[]',
  lyrics_synced TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS spotify_auth (
  user_email TEXT PRIMARY KEY,
  access_token TEXT NOT NULL DEFAULT '',
  refresh_token TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL DEFAULT 0,
  display_name TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS favorites (
  user_email TEXT NOT NULL,
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  PRIMARY KEY (user_email, song_id)
);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS collection_songs (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, song_id)
);
`;

// Run schema bootstrap
(async () => {
  try {
    for (const stmt of SCHEMA_SQL.split(';').map(s => s.trim()).filter(Boolean)) {
      await client.execute(stmt);
    }
  } catch (e) {
    // Schema already exists or DB unavailable — continue
    console.warn('[db] schema bootstrap:', (e as Error).message);
  }
})();

// --- Migration: add lyrics_synced column if missing ---
(async () => {
  try {
    await client.execute('ALTER TABLE songs ADD COLUMN lyrics_synced TEXT NOT NULL DEFAULT \'\'');
  } catch { /* column already exists */ }
})();

// --- Migration: add created_by column if missing ---
(async () => {
  try {
    await client.execute('ALTER TABLE songs ADD COLUMN created_by TEXT NOT NULL DEFAULT \'\'');
  } catch { /* column already exists */ }
})();

// --- Migration: add created_by_name column if missing ---
(async () => {
  try {
    await client.execute('ALTER TABLE songs ADD COLUMN created_by_name TEXT NOT NULL DEFAULT \'\'');
  } catch { /* column already exists */ }
})();

// --- Migration: backfill created_by_name from spotify_auth for existing songs ---
(async () => {
  try {
    await client.execute(`
      UPDATE songs SET created_by_name = (
        SELECT COALESCE(sa.display_name, '')
        FROM spotify_auth sa
        WHERE sa.user_email = songs.created_by
      )
      WHERE created_by_name = '' AND created_by != ''
    `);
  } catch { /* ignore */ }
})();

/**
 * Wrapper that mimics better-sqlite3's prepare() API for minimal route changes.
 *
 * Usage (identical to before, just add `await`):
 *   const row = await db.prepare('SELECT * FROM songs WHERE id = ?').get(id);
 *   const rows = await db.prepare('SELECT * FROM songs').all();
 *   const result = await db.prepare('INSERT ...').run(a, b, c);
 *   // result.rowsAffected, result.lastInsertRowid
 */

interface PreparedStatement {
  get(...args: unknown[]): Promise<Record<string, unknown> | undefined>;
  all(...args: unknown[]): Promise<Record<string, unknown>[]>;
  run(...args: unknown[]): Promise<{ rowsAffected: number; lastInsertRowid: unknown }>;
}

function prepare(sql: string): PreparedStatement {
  return {
    async get(...args: unknown[]) {
      const result = await client.execute({ sql, args: args as (string | number | null)[] });
      return result.rows[0] as Record<string, unknown> | undefined;
    },
    async all(...args: unknown[]) {
      const result = await client.execute({ sql, args: args as (string | number | null)[] });
      return result.rows as Record<string, unknown>[];
    },
    async run(...args: unknown[]) {
      const result = await client.execute({ sql, args: args as (string | number | null)[] });
      return {
        rowsAffected: result.rowsAffected,
        lastInsertRowid: result.lastInsertRowid,
      };
    },
  };
}

/**
 * Execute raw SQL (single or multi-statement).
 * For multi-statement DDL, use execMultiple.
 */
async function exec(sql: string): Promise<void> {
  await client.execute(sql);
}

/**
 * Execute multiple SQL statements (for DDL / migrations).
 * Splits on semicolons and runs each statement.
 */
async function execMultiple(sql: string): Promise<void> {
  for (const stmt of sql.split(';').map(s => s.trim()).filter(Boolean)) {
    await client.execute(stmt);
  }
}

/**
 * Execute a batch of operations in a transaction.
 */
async function batch(stmts: { sql: string; args: unknown[] }[]): Promise<void> {
  await client.batch(
    stmts.map(s => ({ sql: s.sql, args: s.args as (string | number | null)[] })),
    'write'
  );
}

const db = { prepare, exec, execMultiple, batch, client };
export default db;
