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
    id INTEGER PRIMARY KEY CHECK (id = 1),
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

db.prepare('INSERT OR IGNORE INTO spotify_auth (id) VALUES (1)').run();

export default db;
