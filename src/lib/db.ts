import { join, dirname } from 'path';
import { mkdirSync } from 'fs';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Database = require('better-sqlite3');

const DB_PATH = join(process.cwd(), 'data', 'lyrics.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS songs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    artist TEXT NOT NULL DEFAULT '',
    lyrics_raw TEXT NOT NULL DEFAULT '',
    lyrics_furigana TEXT NOT NULL DEFAULT '[]',
    lyrics_synced TEXT NOT NULL DEFAULT '',
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
`);

// Migrate: add lyrics_synced column if missing
try {
  db.exec(`ALTER TABLE songs ADD COLUMN lyrics_synced TEXT NOT NULL DEFAULT ''`);
} catch { /* column already exists */ }

// Migrate: if old single-row spotify_auth exists (id=1 style), drop and recreate
try {
  const info = db.prepare("PRAGMA table_info(spotify_auth)").all();
  const hasIdCol = (info as { name: string }[]).some((c) => c.name === 'id');
  if (hasIdCol) {
    // Old schema — save existing data, recreate, migrate
    const old = db.prepare('SELECT * FROM spotify_auth WHERE id = 1').get() as Record<string, unknown> | undefined;
    db.exec('DROP TABLE spotify_auth');
    db.exec(`
      CREATE TABLE spotify_auth (
        user_email TEXT PRIMARY KEY,
        access_token TEXT NOT NULL DEFAULT '',
        refresh_token TEXT NOT NULL DEFAULT '',
        expires_at INTEGER NOT NULL DEFAULT 0,
        display_name TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      )
    `);
    if (old && old.access_token) {
      db.prepare(
        `INSERT INTO spotify_auth (user_email, access_token, refresh_token, expires_at, display_name) VALUES ('__legacy__', ?, ?, ?, ?)`
      ).run(old.access_token, old.refresh_token, old.expires_at, old.display_name);
    }
  }
} catch { /* migration already done or table doesn't exist */ }

export default db;
