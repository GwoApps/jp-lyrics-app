import test from 'node:test';
import assert from 'node:assert/strict';
import { unlinkSync, readFileSync, readdirSync } from 'node:fs';
import { createClient } from '@libsql/client';

/**
 * Regression test for issue #210.
 *
 * The Drizzle journal (drizzle/meta/_journal.json) must list every migration
 * SQL file in the drizzle/ directory. When a new SQL file is added but its
 * journal entry is forgotten, a fresh database skips that migration forever,
 * leaving required tables/columns missing at runtime (while types still pass
 * and `build` still succeeds).
 *
 * This test replays the exact journal order against a fresh empty SQLite DB
 * and asserts that every table/column the app's schema depends on actually
 * exists afterwards — so the gap can never silently regress.
 */

const ROOT = process.cwd();

interface MigrationEntry { idx: number; tag: string }

function loadJournal(): MigrationEntry[] {
  const raw = readFileSync(`${ROOT}/drizzle/meta/_journal.json`, 'utf-8');
  const journal = JSON.parse(raw);
  return (journal.entries || []).sort((a: MigrationEntry, b: MigrationEntry) => a.idx - b.idx);
}

function listMigrationFiles(): string[] {
  return readdirSync(`${ROOT}/drizzle`)
    .filter(f => /^\d{4}_.*\.sql$/.test(f))
    .sort();
}

async function applyMigrations(client: ReturnType<typeof createClient>, entries: MigrationEntry[]) {
  await client.execute(
    'CREATE TABLE IF NOT EXISTS "__drizzle_migrations" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "hash" TEXT NOT NULL, "created_at" NUMERIC NOT NULL)'
  );
  for (const entry of entries) {
    const sqlPath = `${ROOT}/drizzle/${entry.tag}.sql`;
    const migrationSQL = readFileSync(sqlPath, 'utf-8');
    const statements = migrationSQL.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      await client.execute(stmt);
    }
    await client.execute('INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)', [entry.tag + '.sql', Date.now()]);
  }
}

test('journal covers every migration SQL file (no silent gap)', () => {
  const journalTags = loadJournal().map(e => e.tag);
  const fileTags = listMigrationFiles().map(f => f.replace(/\.sql$/, ''));
  for (const file of fileTags) {
    assert.ok(
      journalTags.includes(file),
      `Migration file drizzle/${file}.sql is missing from drizzle/meta/_journal.json — fresh DBs will never apply it`
    );
  }
});

test('fresh DB applying full journal yields all required tables/columns', async () => {
  const dbPath = `${ROOT}/.tmp-migrations-test.db`;
  try { unlinkSync(dbPath); } catch { /* fresh */ }

  const client = createClient({ url: `file:${dbPath}`, timeout: 15_000 });
  try {
    await applyMigrations(client, loadJournal());

    // Tables the app's schema declares (see src/lib/schema.ts).
    const requiredTables = ['ai_usage', 'song_covers'];

    // songs.* columns added by the previously-omitted migrations.
    const requiredSongColumns = ['cover_palette', 'lyrics_glossary'];

    for (const table of requiredTables) {
      const res = await client.execute(
        `SELECT name FROM sqlite_master WHERE type='table' AND name = '${table}'`
      );
      assert.equal(res.rows.length, 1, `missing table: ${table}`);
    }

    const songCols = await client.execute('PRAGMA table_info(`songs`)');
    const songColNames = new Set(songCols.rows.map(r => r.name as string));
    for (const col of requiredSongColumns) {
      assert.ok(songColNames.has(col), `missing songs.${col} column`);
    }
  } finally {
    client.close();
    try { unlinkSync(dbPath); } catch { /* ignore */ }
  }
});
