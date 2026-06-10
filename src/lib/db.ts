/**
 * Database client — Drizzle ORM with multi-driver support.
 *
 * Supported backends:
 *   1. Cloudflare D1 — via Workers binding (process.env.DB)
 *   2. Turso          — via TURSO_URL + TURSO_AUTH_TOKEN
 *   3. Local SQLite   — via file:data/local.db (Docker / self-hosted)
 *
 * Detection order:
 *   - If process.env.DB is a D1Database object → use drizzle-orm/d1
 *   - If TURSO_URL is set → use drizzle-orm/libsql (HTTP)
 *   - Otherwise → use drizzle-orm/libsql with local file
 *
 * IMPORTANT: libsql imports use dynamic `import()` instead of `require()` so that
 * esbuild resolves @libsql/client via the "workerd" condition in its exports map
 * (→ lib-esm/web.js, pure HTTP/WS, no native bindings). Using require() would hit
 * the "require" condition (→ lib-cjs/node.js) which pulls in native addons like
 * @libsql/linux-x64-musl — incompatible with Cloudflare Workers.
 */
import { type SQLiteTable, type SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { sql, eq, and, or, like, inArray, desc, asc, isNull, isNotNull } from 'drizzle-orm';
import * as schema from './schema';

// Use `any` so getDB() stays synchronous — the actual Drizzle type is the same
// regardless of driver, and we don't want to expose the async init type.
type DrizzleDB = any;

let _db: DrizzleDB = null;

/**
 * Get or create the database instance.
 *
 * For Cloudflare D1: call getDB(env.DB) from your Worker/handler to inject the binding.
 * For Turso/Local: call getDB() with no arguments — detected from env vars.
 *
 * The libsql/Turso/local path uses top-level await for initialisation so that
 * getDB() itself remains synchronous on subsequent calls.
 */
export function getDB(d1Binding?: unknown): DrizzleDB {
  // D1 mode: always create fresh (bindings are per-request on CF)
  // Uses require() — drizzle-orm/d1 has no native deps and is safe to bundle.
  if (d1Binding) {
    const { drizzle } = require('drizzle-orm/d1') as typeof import('drizzle-orm/d1');
    return drizzle(d1Binding as any, { schema });
  }

  // Singleton for Turso / local (initialised eagerly below via top-level await)
  return _db;
}

// --- Eager initialisation for non-D1 backends (Node.js / Docker) ---
// Uses top-level await + dynamic import() so esbuild resolves through
// the "import.workerd" condition in @libsql/client's package.json exports,
// avoiding native bindings in CF Workers builds.
// On CF Workers, process.env.DB is always set (D1 binding), so this block
// is effectively dead code in that environment — but esbuild still bundles
// the import() target, which is why the workerd resolution matters.
if (!process.env.DB) {
  try {
    // Ensure data directory exists (Node.js runtime only)
    const fs = require('fs') as typeof import('fs');
    fs.mkdirSync('data', { recursive: true });
  } catch { /* already exists, or fs unavailable (edge) */ }

  const [{ drizzle }, { createClient }] = await Promise.all([
    import('drizzle-orm/libsql'),
    import('@libsql/client'),
  ]);

  if (process.env.TURSO_URL) {
    const client = createClient({
      url: process.env.TURSO_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    _db = drizzle(client, { schema });
  } else {
    const client = createClient({ url: 'file:data/local.db' });
    _db = drizzle(client, { schema });
  }
}

// --- Schema bootstrap (runs once for non-D1 backends) ---

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

async function bootstrapSchema() {
  if (process.env.DB) return; // D1 manages its own schema
  try {
    const db = getDB();
    for (const stmt of SCHEMA_SQL.split(';').map(s => s.trim()).filter(Boolean)) {
      await db.run(sql.raw(stmt));
    }
  } catch (e) {
    console.warn('[db] schema bootstrap:', (e as Error).message);
  }
}

// Run bootstrap (fire-and-forget)
bootstrapSchema();

// Re-export Drizzle query helpers for convenience
export { schema, sql, eq, and, or, like, inArray, desc, asc, isNull, isNotNull };
export type { SQLiteTable, SQLiteColumn };
