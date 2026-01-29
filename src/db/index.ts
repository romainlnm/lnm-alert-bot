import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import * as schema from './schema.js'

const dbPath = process.env.DATABASE_PATH || './data/alerts.db'

// Ensure data directory exists
mkdirSync(dirname(dbPath), { recursive: true })

const sqlite = new Database(dbPath)
export const db = drizzle(sqlite, { schema })

// Initialize tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    api_key TEXT,
    api_secret TEXT,
    passphrase TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    target_value REAL NOT NULL,
    position_id TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    repeating INTEGER NOT NULL DEFAULT 0,
    last_triggered_at INTEGER,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_alerts_telegram_id ON alerts(telegram_id);
  CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(active);
`)

export { schema }
