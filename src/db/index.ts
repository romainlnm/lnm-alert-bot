import initSqlJs, { Database } from 'sql.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'

const dbPath = process.env.DATABASE_PATH || './data/alerts.db'

let db: Database

export async function initDb(): Promise<void> {
  const SQL = await initSqlJs()

  mkdirSync(dirname(dbPath), { recursive: true })

  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id INTEGER PRIMARY KEY,
      username TEXT,
      api_key TEXT,
      api_secret TEXT,
      passphrase TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      target_value REAL NOT NULL,
      time_window_minutes INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      last_triggered_at INTEGER,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      price REAL NOT NULL,
      timestamp INTEGER NOT NULL
    )
  `)

  saveDb()
}

export function saveDb(): void {
  const data = db.export()
  const buffer = Buffer.from(data)
  writeFileSync(dbPath, buffer)
}

// User operations
export function getOrCreateUser(telegramId: number, username?: string): void {
  const existing = db.exec(`SELECT telegram_id FROM users WHERE telegram_id = ${telegramId}`)
  if (existing.length === 0 || existing[0].values.length === 0) {
    db.run(`INSERT INTO users (telegram_id, username) VALUES (?, ?)`, [telegramId, username || null])
    saveDb()
  }
}

// Alert operations
export interface Alert {
  id: number
  telegram_id: number
  type: string
  target_value: number
  time_window_minutes: number | null
  active: boolean
  last_triggered_at: number | null
}

export function createAlert(
  telegramId: number,
  type: string,
  targetValue: number,
  timeWindowMinutes?: number
): void {
  db.run(
    `INSERT INTO alerts (telegram_id, type, target_value, time_window_minutes) VALUES (?, ?, ?, ?)`,
    [telegramId, type, targetValue, timeWindowMinutes || null]
  )
  saveDb()
}

export function getActiveAlerts(): Alert[] {
  const result = db.exec(`SELECT * FROM alerts WHERE active = 1`)
  if (result.length === 0) return []

  const columns = result[0].columns
  return result[0].values.map((row: unknown[]) => {
    const obj: Record<string, unknown> = {}
    columns.forEach((col: string, i: number) => (obj[col] = row[i]))
    obj.active = obj.active === 1
    return obj as unknown as Alert
  })
}

export function getUserAlerts(telegramId: number): Alert[] {
  const result = db.exec(`SELECT * FROM alerts WHERE telegram_id = ${telegramId} AND active = 1`)
  if (result.length === 0) return []

  const columns = result[0].columns
  return result[0].values.map((row: unknown[]) => {
    const obj: Record<string, unknown> = {}
    columns.forEach((col: string, i: number) => (obj[col] = row[i]))
    obj.active = obj.active === 1
    return obj as unknown as Alert
  })
}

export function deactivateAlert(alertId: number, telegramId: number): void {
  db.run(`UPDATE alerts SET active = 0 WHERE id = ? AND telegram_id = ?`, [alertId, telegramId])
  saveDb()
}

export function markAlertTriggered(alertId: number, deactivate = true): void {
  const now = Math.floor(Date.now() / 1000)
  if (deactivate) {
    db.run(`UPDATE alerts SET active = 0, last_triggered_at = ? WHERE id = ?`, [now, alertId])
  } else {
    db.run(`UPDATE alerts SET last_triggered_at = ? WHERE id = ?`, [now, alertId])
  }
  saveDb()
}

// Price history
export function addPriceHistory(price: number): void {
  const now = Math.floor(Date.now() / 1000)
  db.run(`INSERT INTO price_history (price, timestamp) VALUES (?, ?)`, [price, now])

  // Clean old entries (keep last 24h)
  const cutoff = now - 24 * 60 * 60
  db.run(`DELETE FROM price_history WHERE timestamp < ?`, [cutoff])
  saveDb()
}

export function getPriceAtTime(secondsAgo: number): number | null {
  const targetTime = Math.floor(Date.now() / 1000) - secondsAgo
  const result = db.exec(
    `SELECT price FROM price_history WHERE timestamp <= ${targetTime} ORDER BY timestamp DESC LIMIT 1`
  )
  if (result.length === 0 || result[0].values.length === 0) return null
  return result[0].values[0][0] as number
}
