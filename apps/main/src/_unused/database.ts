import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { app } from 'electron';

let db: DatabaseType | null = null;

function resolveDbPath(): string {
  const override = process.env.KANATA_DB_PATH;
  if (override) return override;
  const dir = app.getPath('userData');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'kanata.db');
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS watchlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT 'local',
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS watchlist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  watchlist_id INTEGER NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  market TEXT NOT NULL DEFAULT 'US',
  display_name TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(watchlist_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_items_watchlist_pos
  ON watchlist_items(watchlist_id, position);
`;

export function initDatabase(): DatabaseType {
  if (db) return db;
  const path = resolveDbPath();
  console.log(`[db] opening ${path}`);
  db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  seedDefaultWatchlist(db);
  return db;
}

function seedDefaultWatchlist(conn: DatabaseType): void {
  const row = conn.prepare('SELECT id FROM watchlists WHERE user_id = ? LIMIT 1').get('local') as
    | { id: number }
    | undefined;
  if (row) return;
  const now = new Date().toISOString();
  conn
    .prepare(
      `INSERT INTO watchlists (user_id, name, position, is_default, created_at, updated_at)
       VALUES ('local', 'Default', 0, 1, ?, ?)`,
    )
    .run(now, now);
}

export function getDatabase(): DatabaseType {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
