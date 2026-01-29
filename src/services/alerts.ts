import { eq, and } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { priceFeed } from './price-feed.js'
import type { Bot } from 'grammy'

const COOLDOWN_MS = 5 * 60 * 1000 // 5 min cooldown

export class AlertEngine {
  private bot: Bot
  private intervalId?: ReturnType<typeof setInterval>

  constructor(bot: Bot) {
    this.bot = bot
  }

  start(): void {
    // Check alerts every 10 seconds
    this.intervalId = setInterval(() => this.checkAlerts(), 10_000)
    console.log('Alert engine started')
  }

  stop(): void {
    if (this.intervalId) clearInterval(this.intervalId)
  }

  private async checkAlerts(): Promise<void> {
    const price = priceFeed.currentPrice
    if (!price) return

    const activeAlerts = await db
      .select()
      .from(schema.alerts)
      .where(eq(schema.alerts.active, true))

    for (const alert of activeAlerts) {
      if (!this.shouldTrigger(alert)) continue

      let triggered = false
      let message = ''

      switch (alert.type) {
        case 'price_above':
          if (price >= alert.targetValue) {
            triggered = true
            message = `📈 <b>Price Alert!</b>\n\nBTC is now above <b>$${alert.targetValue.toLocaleString()}</b>\n\nCurrent: $${price.toLocaleString()}`
          }
          break

        case 'price_below':
          if (price <= alert.targetValue) {
            triggered = true
            message = `📉 <b>Price Alert!</b>\n\nBTC is now below <b>$${alert.targetValue.toLocaleString()}</b>\n\nCurrent: $${price.toLocaleString()}`
          }
          break

        case 'percent_change':
          const minutes = alert.timeWindowMinutes ?? 60
          const change = priceFeed.getPercentChange(minutes)

          if (change !== null) {
            const target = alert.targetValue
            // Negative target = looking for drops, positive = looking for rises
            if ((target < 0 && change <= target) || (target > 0 && change >= target)) {
              triggered = true
              const timeStr = minutes >= 60 ? `${minutes / 60}h` : `${minutes}min`
              const emoji = change < 0 ? '📉' : '📈'
              message = `${emoji} <b>Price Movement Alert!</b>\n\nBTC has moved <b>${change >= 0 ? '+' : ''}${change.toFixed(2)}%</b> in the last ${timeStr}\n\nCurrent: $${price.toLocaleString()}`
            }
          }
          break
      }

      if (triggered) {
        await this.sendAlert(alert, message)
      }
    }
  }

  private shouldTrigger(alert: typeof schema.alerts.$inferSelect): boolean {
    if (!alert.lastTriggeredAt) return true
    return Date.now() - alert.lastTriggeredAt.getTime() >= COOLDOWN_MS
  }

  private async sendAlert(
    alert: typeof schema.alerts.$inferSelect,
    message: string
  ): Promise<void> {
    try {
      await this.bot.api.sendMessage(alert.telegramId, message, {
        parse_mode: 'HTML',
      })

      // Deactivate one-time alerts
      await db
        .update(schema.alerts)
        .set({ active: false, lastTriggeredAt: new Date() })
        .where(eq(schema.alerts.id, alert.id))

      console.log(`Alert ${alert.id} triggered for user ${alert.telegramId}`)
    } catch (error) {
      console.error(`Failed to send alert ${alert.id}:`, error)
    }
  }
}
