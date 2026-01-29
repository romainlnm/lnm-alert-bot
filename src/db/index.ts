import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import * as schema from './schema.js'

const dbPath = process.env.DATABASE_PATH || './data/alerts.db'
mkdirSync(dirname(dbPath), { recursive: true })

const sqlite = new Database(dbPath)
export const db = drizzle(sqlite, { schema })

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    api_key TEXT,
    api_secret TEXT,
    passphrase TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    target_value REAL NOT NULL,
    time_window_minutes INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    last_triggered_at INTEGER,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    price REAL NOT NULL,
    timestamp INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(active);
  CREATE INDEX IF NOT EXISTS idx_price_history_timestamp ON price_history(timestamp);
`)

export { schema }
