import { getActiveAlerts, markAlertTriggered, type Alert } from '../db/index.js'
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
    this.intervalId = setInterval(() => this.checkAlerts(), 10_000)
    console.log('Alert engine started')
  }

  stop(): void {
    if (this.intervalId) clearInterval(this.intervalId)
  }

  private async checkAlerts(): Promise<void> {
    const price = priceFeed.currentPrice
    if (!price) return

    const alerts = getActiveAlerts()

    for (const alert of alerts) {
      if (!this.shouldTrigger(alert)) continue

      let triggered = false
      let message = ''

      switch (alert.type) {
        case 'price_above':
          if (price >= alert.target_value) {
            triggered = true
            message = `📈 <b>Price Alert!</b>\n\nBTC is now above <b>$${alert.target_value.toLocaleString()}</b>\n\nCurrent: $${price.toLocaleString()}`
          }
          break

        case 'price_below':
          if (price <= alert.target_value) {
            triggered = true
            message = `📉 <b>Price Alert!</b>\n\nBTC is now below <b>$${alert.target_value.toLocaleString()}</b>\n\nCurrent: $${price.toLocaleString()}`
          }
          break

        case 'percent_change':
          const minutes = alert.time_window_minutes ?? 60
          const change = priceFeed.getPercentChange(minutes)

          if (change !== null) {
            const target = alert.target_value
            if ((target < 0 && change <= target) || (target > 0 && change >= target)) {
              triggered = true
              const timeStr = minutes >= 60 ? `${minutes / 60}h` : `${minutes}min`
              const emoji = change < 0 ? '📉' : '📈'
              message = `${emoji} <b>Price Movement!</b>\n\nBTC moved <b>${change >= 0 ? '+' : ''}${change.toFixed(2)}%</b> in ${timeStr}\n\nCurrent: $${price.toLocaleString()}`
            }
          }
          break
      }

      if (triggered) {
        await this.sendAlert(alert, message)
      }
    }
  }

  private shouldTrigger(alert: Alert): boolean {
    if (!alert.last_triggered_at) return true
    return Date.now() - alert.last_triggered_at * 1000 >= COOLDOWN_MS
  }

  private async sendAlert(alert: Alert, message: string): Promise<void> {
    try {
      await this.bot.api.sendMessage(alert.telegram_id, message, { parse_mode: 'HTML' })
      markAlertTriggered(alert.id, true)
      console.log(`Alert ${alert.id} triggered for user ${alert.telegram_id}`)
    } catch (error) {
      console.error(`Failed to send alert ${alert.id}:`, error)
    }
  }
}
