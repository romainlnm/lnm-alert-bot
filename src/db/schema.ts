import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  telegramId: integer('telegram_id').primaryKey(),
  username: text('username'),
  // Encrypted API credentials (null = public user only)
  apiKey: text('api_key'),
  apiSecret: text('api_secret'),
  passphrase: text('passphrase'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

export const alerts = sqliteTable('alerts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramId: integer('telegram_id')
    .notNull()
    .references(() => users.telegramId, { onDelete: 'cascade' }),
  // Alert type: price_above, price_below, funding_above, funding_below, margin_below, liquidation_distance
  type: text('type').notNull(),
  // Target value (price, rate, or percentage depending on type)
  targetValue: real('target_value').notNull(),
  // For position-specific alerts
  positionId: text('position_id'),
  // Whether alert is active
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  // Whether alert should repeat or fire once
  repeating: integer('repeating', { mode: 'boolean' }).notNull().default(false),
  // Last time alert was triggered (to prevent spam)
  lastTriggeredAt: integer('last_triggered_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Alert = typeof alerts.$inferSelect
export type NewAlert = typeof alerts.$inferInsert
