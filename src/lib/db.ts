import { join, dirname } from 'path';
import { mkdirSync } from 'fs';

// Use require for CJS-only modules in ESM context
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Database = require('better-sqlite3');

const DB_PATH = join(process.cwd(), 'data', 'lyrics.db');

// Ensure data directory exists
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = Database(DB_PATH);

// Enable WAL for better concurrent read performance
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS songs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    artist TEXT NOT NULL DEFAULT '',
    lyrics_raw TEXT NOT NULL DEFAULT '',
    lyrics_furigana TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
`);

export default db;
