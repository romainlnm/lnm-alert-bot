import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  telegramId: integer('telegram_id').primaryKey(),
  username: text('username'),
  apiKey: text('api_key'),
  apiSecret: text('api_secret'),
  passphrase: text('passphrase'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

export const alerts = sqliteTable('alerts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramId: integer('telegram_id').notNull(),
  type: text('type').notNull(), // price_above, price_below, percent_change, etc.
  targetValue: real('target_value').notNull(), // price or percentage
  timeWindowMinutes: integer('time_window_minutes'), // for smart alerts
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  lastTriggeredAt: integer('last_triggered_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// Store price history for smart alerts
export const priceHistory = sqliteTable('price_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  price: real('price').notNull(),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
})

export type User = typeof users.$inferSelect
export type Alert = typeof alerts.$inferSelect
