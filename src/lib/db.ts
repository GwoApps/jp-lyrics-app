/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
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
import * as schema from './schema.ts';

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
    // timeout = SQLite busy timeout (ms): concurrent route modules all import this
    // file and run migrations against the same local DB during `next build`
    // ("Collecting page data" spawns multiple workers). Without it they race and
    // fail with SQLITE_BUSY / duplicate column errors.
    const client = libsql.createClient({ url: 'file:data/local.db', timeout: 15_000 });
    _db = drizzle(client, { schema });
  }
}

// --- Schema migration via Drizzle (runs once for non-D1 backends) ---

import * as path from 'path';
import * as fs from 'fs';

interface MigrationEntry { idx: number; tag: string }

/**
 * Give `playlist_import_track_results` its slot identity (ISSUE #347).
 *
 * Migration 0022 adds `track_index`, but SQLite keeps the *value* of a newly
 * added column implicit for rows that already existed: `UPDATE … SET track_index
 * = 0` (and even an index over an expression on the column) still sees the
 * stored `NULL`, so two legacy rows of the same job keep colliding and
 * `UNIQUE (job_id, track_index)` cannot be built. The only reliable way to
 * materialise a value for those rows is to rebuild the table, which is also the
 * right moment to give them a slot:
 *
 *  - legacy rows (written before 0022) carry no slot information. We refuse to
 *    guess it — a wrong guess would mis-count a resumed job — so they are
 *    renumbered into *negative* slots, one per row, by creation order. They can
 *    never collide with a real slot (`>= 0`, used by every new write), and
 *    `getPersistedTrackResults()` still refuses to resume such a job.
 *  - rows that already have a real slot (0, 1, …) are copied verbatim.
 *
 * Additive from the app's point of view: `playlist_import_jobs` is untouched, so
 * the job counters and everything the client reads keep their meaning. The
 * caller wraps this in its own write transaction.
 */
async function repairPlaylistImportSlotIdentity(
  execute: (statement: string) => Promise<unknown>,
) {
  type Rows = { rows: Record<string, unknown>[] };
  const table = (await execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='playlist_import_track_results'`
  )) as Rows;
  if (table.rows.length === 0) return;

  const index = (await execute(
    `SELECT name FROM sqlite_master WHERE type='index' AND name='playlist_import_track_results_job_track_idx'`
  )) as Rows;
  if (index.rows.length > 0) return;

  // No `track_index` yet → migration 0022 has not run, so there is nothing to
  // repair. (It runs right after this check when it is part of the pending set.)
  const columns = (await execute(`PRAGMA table_info(playlist_import_track_results)`)) as Rows;
  if (!columns.rows.some((c) => c.name === 'track_index')) return;

  const ambiguous = (await execute(`
    SELECT count(*) AS n FROM (
      SELECT job_id, track_index FROM playlist_import_track_results
      GROUP BY job_id, track_index HAVING count(*) > 1
    )
  `)) as Rows;
  if (Number(ambiguous.rows[0]?.n ?? 0) === 0) {
    // Every row already sits on its own slot — just enforce it.
    await execute(
      `CREATE UNIQUE INDEX IF NOT EXISTS playlist_import_track_results_job_track_idx
       ON playlist_import_track_results (job_id, track_index)`
    );
    return;
  }

  // Rows that share a slot are the ambiguous legacy ones. Rebuild the table so
  // their slot becomes a materialised negative value.
  await execute(`DROP INDEX IF EXISTS playlist_import_track_results_job_track_idx`);
  await execute(`DROP TABLE IF EXISTS playlist_import_track_results_rebuild`);
  await execute(`CREATE TABLE playlist_import_track_results_rebuild (
    job_id text NOT NULL,
    spotify_track_id text NOT NULL,
    track_index integer DEFAULT 0 NOT NULL,
    title text NOT NULL,
    artist text NOT NULL,
    status text NOT NULL,
    needs_review integer DEFAULT 0 NOT NULL,
    created_at text DEFAULT (datetime('now', 'localtime')) NOT NULL
  )`);
  const LEGACY_ROWS = `rowid IN (
    SELECT rowid FROM playlist_import_track_results AS dup
    WHERE (SELECT count(*) FROM playlist_import_track_results AS x
           WHERE x.job_id = dup.job_id AND x.track_index = dup.track_index) > 1
  )`;
  await execute(`
    INSERT INTO playlist_import_track_results_rebuild
      (job_id, spotify_track_id, track_index, title, artist, status, needs_review, created_at)
    SELECT job_id, spotify_track_id,
           -ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY created_at, rowid),
           title, artist, status, needs_review, created_at
    FROM playlist_import_track_results WHERE ${LEGACY_ROWS}
  `);
  await execute(`
    INSERT INTO playlist_import_track_results_rebuild
      (job_id, spotify_track_id, track_index, title, artist, status, needs_review, created_at)
    SELECT job_id, spotify_track_id, track_index, title, artist, status, needs_review, created_at
    FROM playlist_import_track_results WHERE rowid NOT IN (
      SELECT rowid FROM playlist_import_track_results AS dup
      WHERE (SELECT count(*) FROM playlist_import_track_results AS x
             WHERE x.job_id = dup.job_id AND x.track_index = dup.track_index) > 1
    )
  `);
  await execute(`DROP TABLE playlist_import_track_results`);
  await execute(`ALTER TABLE playlist_import_track_results_rebuild RENAME TO playlist_import_track_results`);
  await execute(`CREATE INDEX IF NOT EXISTS playlist_import_track_results_job_id_idx
    ON playlist_import_track_results (job_id)`);
  await execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS playlist_import_track_results_job_track_idx
     ON playlist_import_track_results (job_id, track_index)`
  );
  console.log('[db] playlist_import_track_results: rebuilt with (job_id, track_index) identity (ISSUE #347)');
}

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

  const now = Date.now();

  // Run the whole check-and-apply flow inside a single write transaction.
  // `next build` loads every route module in parallel workers and each one runs
  // this code. Without a transaction the per-statement autocommits interleave
  // across workers and leave a half-migrated DB (column added but journal row
  // missing) or duplicate journal rows. "write" mode issues BEGIN IMMEDIATE;
  // combined with the client busy timeout it serialises the workers, so the
  // second worker re-reads the journal inside the lock, sees the migrations
  // already recorded and applies nothing.
  const tx: import('@libsql/client').Transaction = await db.$client.transaction('write');
  try {
    // Check which migrations have been applied (inside the lock)
    const applied = await tx.execute('SELECT hash FROM "__drizzle_migrations"');
    const appliedSet = new Set(applied.rows.map(r => r.hash as string));

    // Find pending migrations
    const pending = entries.filter(e => !appliedSet.has(e.tag + '.sql'));

    if (pending.length === 0) {
      // Nothing to do — close without commit (rolls back the empty transaction).
      return;
    }

    // If this is an existing DB (has tables besides __drizzle_migrations) and the
    // first pending migration is 0000 (baseline), mark it as applied without executing
    const tables = await tx.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name != '__drizzle_migrations' AND name NOT LIKE 'sqlite_%'`
    );

    for (const entry of pending) {
      const tag = entry.tag + '.sql';
      const sqlPath = path.join(migrationsDir, tag);

      if (entry.idx === 0 && tables.rows.length > 0) {
        // Baseline: existing DB already has tables, just mark as applied
        console.log(`[db] Baseline: marking ${tag} as applied (existing DB)`);
        await tx.execute({ sql: `INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)`, args: [tag, now] });
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
      const addsTrackIndex = tag === '0022_playlist_import_track_index.sql';
      for (const stmt of statements) {
        // Idempotent DDL: skip if the column/table already exists. This lets a
        // DB left in a half-migrated state by a previous crashed build self-heal
        // instead of failing with "duplicate column name".
        const normalized = stmt.replace(/\s+/g, ' ').trim();
        const alterMatch = /^ALTER\s+TABLE\s+`?([^\s`]+)`?\s+ADD(?:\s+COLUMN)?\s+`?([^\s`]+)`?/i.exec(normalized);
        if (alterMatch) {
          const [, table, column] = alterMatch;
          const tableInfo = await tx.execute(`PRAGMA table_info(\`${table}\`)`);
          if (tableInfo.rows.some(c => c.name === column)) {
            console.log(`[db] ${tag}: column ${table}.${column} already exists, skipping`);
            continue;
          }
        }
        const createMatch = /^CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+`?([^\s`]+)`?/i.exec(normalized);
        if (createMatch && !/IF\s+NOT\s+EXISTS/i.test(normalized)) {
          const tableName = createMatch[1];
          const existing = await tx.execute(`SELECT name FROM sqlite_master WHERE type='table' AND name = '${tableName}'`);
          if (existing.rows.length > 0) {
            console.log(`[db] ${tag}: table ${tableName} already exists, skipping`);
            continue;
          }
        }
        await tx.execute(stmt);
      }
      if (addsTrackIndex) {
        // Build the unique index here, inside the same transaction, before
        // migration 0023 runs: on a populated database that CREATE UNIQUE INDEX
        // would fail and abort the whole migration run (ISSUE #347).
        await repairPlaylistImportSlotIdentity((statement) => tx.execute(statement));
      }
      await tx.execute({ sql: `INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)`, args: [tag, now] });
    }
    await tx.commit();
    console.log('[db] Migrations applied');
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
}

// Block module initialisation until schema is ready; route handlers must never race migrations.
await runMigrations();

// Safety net for databases that are already fully migrated (their journal has
// every entry, so `runMigrations()` had nothing to do) but whose slot-identity
// index is missing — e.g. a DB restored after a partially applied migration.
if (!_isD1) {
  const client: import('@libsql/client').Client = getDB().$client;
  const tx = await client.transaction('write');
  try {
    await repairPlaylistImportSlotIdentity((statement) => tx.execute(statement));
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
}

// Re-export Drizzle query helpers for convenience
export { schema, sql, eq, and, or, like, inArray, desc, asc, isNull, isNotNull };
export type { SQLiteTable, SQLiteColumn };
