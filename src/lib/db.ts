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
 */
import { type SQLiteTable, type SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { sql, eq, and, or, like, inArray, desc, asc, isNull, isNotNull } from 'drizzle-orm';
import * as schema from './schema';

type DrizzleDB = ReturnType<typeof createLocalDB>;

let _db: DrizzleDB | null = null;

/** Create Drizzle instance backed by local SQLite file */
function createLocalDB() {
  // Ensure data directory exists (Node.js runtime only)
  try {
    const fs = require('fs') as typeof import('fs');
    fs.mkdirSync('data', { recursive: true });
  } catch { /* already exists, or fs unavailable */ }

  const { drizzle } = require('drizzle-orm/libsql') as typeof import('drizzle-orm/libsql');
  const { createClient } = require('@libsql/client') as typeof import('@libsql/client');
  const client = createClient({ url: 'file:data/local.db' });
  return drizzle(client, { schema });
}

/** Create Drizzle instance backed by Turso (HTTP) */
function createTursoDB() {
  const { drizzle } = require('drizzle-orm/libsql') as typeof import('drizzle-orm/libsql');
  const { createClient } = require('@libsql/client') as typeof import('@libsql/client');
  const client = createClient({
    url: process.env.TURSO_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  return drizzle(client, { schema });
}

/** Create Drizzle instance backed by Cloudflare D1 binding */
function createD1DB(d1Binding: unknown) {
  const { drizzle } = require('drizzle-orm/d1') as typeof import('drizzle-orm/d1');
  return drizzle(d1Binding as any, { schema });
}

/**
 * Get or create the database instance.
 *
 * For Cloudflare D1: call getDB(env.DB) from your Worker/handler to inject the binding.
 * For Turso/Local: call getDB() with no arguments — detected from env vars.
 */
export function getDB(d1Binding?: unknown) {
  // D1 mode: always create fresh (bindings are per-request on CF)
  if (d1Binding) {
    return createD1DB(d1Binding);
  }

  // Singleton for Turso / local
  if (_db) return _db;

  if (process.env.TURSO_URL) {
    _db = createTursoDB();
  } else {
    _db = createLocalDB();
  }

  return _db;
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
