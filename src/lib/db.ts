/**
 * Database client — Drizzle ORM with multi-driver support.
 *
 * Supported backends:
 *   1. Cloudflare D1 — via Workers binding (auto-detected from CF context)
 *   2. Turso          — via TURSO_URL + TURSO_AUTH_TOKEN
 *   3. Local SQLite   — via file:data/local.db (Docker / self-hosted)
 *
 * Detection order:
 *   - If Cloudflare D1 binding `DB` exists in the CF runtime context → use drizzle-orm/d1
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
let _isD1 = false;

/**
 * Try to get the D1 binding from the Cloudflare runtime context.
 * OpenNext stores `{ env, ctx, cf }` on globalThis via Symbol("__cloudflare-context__").
 */
function getD1Binding(): unknown | undefined {
  try {
    const ctx = (globalThis as any)[Symbol.for('__cloudflare-context__')];
    const binding = ctx?.['env']?.['DB'];
    // D1 bindings are objects with a `prepare` method, not strings
    if (binding && typeof binding === 'object' && typeof (binding as any).prepare === 'function') {
      return binding;
    }
  } catch { /* not on CF Workers */ }
  return undefined;
}

/**
 * Get or create the database instance.
 *
 * Auto-detects the backend:
 *   1. Cloudflare D1 — checks `globalThis[Symbol.for("__cloudflare-context__")].env.DB`
 *   2. Turso — checks `TURSO_URL` env var
 *   3. Local SQLite — fallback to `file:data/local.db`
 *
 * The libsql/Turso/local path uses top-level await for initialisation so that
 * getDB() itself remains synchronous on subsequent calls.
 */
export function getDB(): DrizzleDB {
  // D1 mode: create fresh per call (bindings are per-request on CF)
  // Uses require() — drizzle-orm/d1 has no native deps and is safe to bundle.
  if (_isD1) {
    const binding = getD1Binding()!;
    const { drizzle } = require('drizzle-orm/d1') as typeof import('drizzle-orm/d1');
    return drizzle(binding as any, { schema });
  }

  // Singleton for Turso / local (initialised eagerly below via top-level await)
  return _db;
}

// --- Eager initialisation for non-D1 backends (Node.js / Docker) ---
// Uses top-level await + dynamic import() so esbuild resolves through
// the "import.workerd" condition in @libsql/client's package.json exports,
// avoiding native bindings in CF Workers builds.
// On CF Workers with D1, getD1Binding() returns a binding → set _isD1 flag.
// The libsql import() is still bundled (esbuild can't tree-shake it), but
// with the workerd condition it resolves to the pure-JS web.js entry point.
const _d1 = getD1Binding();
if (_d1) {
  _isD1 = true;
} else {
  try {
    // Ensure data directory exists (Node.js runtime only)
    const fs = require('fs') as typeof import('fs');
    fs.mkdirSync('data', { recursive: true });
  } catch { /* already exists, or fs unavailable (edge) */ }

  const [{ drizzle }, libsql] = await Promise.all([
    import('drizzle-orm/libsql'),
    import('@libsql/client'),
  ]);

  if (process.env.TURSO_URL) {
    const client = libsql.createClient({
      url: process.env.TURSO_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    _db = drizzle(client, { schema });
  } else {
    const client = libsql.createClient({ url: 'file:data/local.db' });
    _db = drizzle(client, { schema });
  }
}

// --- Schema migration via Drizzle (runs once for non-D1 backends) ---

import * as path from 'path';
import * as fs from 'fs';

interface MigrationEntry { idx: number; tag: string }

async function runMigrations() {
  if (_isD1) return; // D1 manages its own schema via wrangler

  const db = getDB();
  const migrationsDir = path.resolve('drizzle');
  const journalPath = path.join(migrationsDir, 'meta', '_journal.json');

  // Read journal
  if (!fs.existsSync(journalPath)) return;
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
  const entries: MigrationEntry[] = journal.entries || [];
  if (entries.length === 0) return;

  // Create __drizzle_migrations table if not exists
  await db.run(sql.raw(
    `CREATE TABLE IF NOT EXISTS "__drizzle_migrations" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "hash" TEXT NOT NULL, "created_at" NUMERIC NOT NULL)`
  ));

  // Check which migrations have been applied
  const applied = await db.all(sql`SELECT hash FROM "__drizzle_migrations"`);
  const appliedSet = new Set(applied.map((r: any) => r.hash));

  // Find pending migrations
  const pending = entries.filter(e => !appliedSet.has(e.tag + '.sql'));

  if (pending.length === 0) return;

  // If this is an existing DB (has tables besides __drizzle_migrations) and the
  // first pending migration is 0000 (baseline), mark it as applied without executing
  const tables = await db.all(
    sql`SELECT name FROM sqlite_master WHERE type='table' AND name != '__drizzle_migrations' AND name NOT LIKE 'sqlite_%'`
  );

  const now = Date.now();
  for (const entry of pending) {
    const tag = entry.tag + '.sql';
    const sqlPath = path.join(migrationsDir, tag);

    if (entry.idx === 0 && tables.length > 0) {
      // Baseline: existing DB already has tables, just mark as applied
      console.log(`[db] Baseline: marking ${tag} as applied (existing DB)`);
      await db.run(sql`INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (${tag}, ${now})`);
      continue;
    }

    // Apply migration SQL
    if (!fs.existsSync(sqlPath)) {
      console.warn(`[db] Migration file not found: ${tag}, skipping`);
      continue;
    }
    const migrationSQL = fs.readFileSync(sqlPath, 'utf-8');
    // Split by statement-breakpoint (drizzle-kit convention)
    const statements = migrationSQL.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);
    console.log(`[db] Applying ${tag} (${statements.length} statements)`);
    for (const stmt of statements) {
      await db.run(sql.raw(stmt));
    }
    await db.run(sql`INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (${tag}, ${now})`);
  }
  console.log('[db] Migrations applied');
}

// Block module initialisation until schema is ready; route handlers must never race migrations.
await runMigrations();

// Re-export Drizzle query helpers for convenience
export { schema, sql, eq, and, or, like, inArray, desc, asc, isNull, isNotNull };
export type { SQLiteTable, SQLiteColumn };
