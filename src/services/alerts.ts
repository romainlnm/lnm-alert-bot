import { eq, and } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { priceFeed } from './price-feed.js'
import { LNMarketsClient } from './lnmarkets.js'
import type { Bot, Context } from 'grammy'
import type { Alert, User } from '../db/schema.js'

const COOLDOWN_MS = 60_000 // 1 minute cooldown between repeated alerts

export class AlertEngine {
  private bot: Bot<Context>
  private checkInterval?: ReturnType<typeof setInterval>

  constructor(bot: Bot<Context>) {
    this.bot = bot
  }

  start(): void {
    // Subscribe to price feed updates
    priceFeed.on('ticker', () => this.checkPriceAlerts())
    priceFeed.on('funding', () => this.checkFundingAlerts())

    // Check margin alerts periodically (requires API calls per user)
    this.checkInterval = setInterval(
      () => this.checkMarginAlerts(),
      30_000 // Every 30 seconds
    )

    console.log('Alert engine started')
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = undefined
    }
    console.log('Alert engine stopped')
  }

  private async checkPriceAlerts(): Promise<void> {
    const price = priceFeed.currentPrice
    if (!price) return

    const activeAlerts = await db
      .select()
      .from(schema.alerts)
      .where(
        and(
          eq(schema.alerts.active, true),
          // Only price alerts
        )
      )

    for (const alert of activeAlerts) {
      if (alert.type !== 'price_above' && alert.type !== 'price_below') continue
      if (!this.shouldTrigger(alert)) continue

      const triggered =
        (alert.type === 'price_above' && price >= alert.targetValue) ||
        (alert.type === 'price_below' && price <= alert.targetValue)

      if (triggered) {
        await this.triggerAlert(alert, {
          price,
          message: this.formatPriceAlert(alert, price),
        })
      }
    }
  }

  private async checkFundingAlerts(): Promise<void> {
    const rate = priceFeed.currentFundingRate
    if (rate === undefined) return

    const activeAlerts = await db
      .select()
      .from(schema.alerts)
      .where(eq(schema.alerts.active, true))

    for (const alert of activeAlerts) {
      if (alert.type !== 'funding_above' && alert.type !== 'funding_below') continue
      if (!this.shouldTrigger(alert)) continue

      const triggered =
        (alert.type === 'funding_above' && rate >= alert.targetValue) ||
        (alert.type === 'funding_below' && rate <= alert.targetValue)

      if (triggered) {
        await this.triggerAlert(alert, {
          rate,
          message: this.formatFundingAlert(alert, rate),
        })
      }
    }
  }

  private async checkMarginAlerts(): Promise<void> {
    // Get users with API credentials and active margin alerts
    const usersWithMarginAlerts = await db
      .select({
        user: schema.users,
        alert: schema.alerts,
      })
      .from(schema.alerts)
      .innerJoin(schema.users, eq(schema.alerts.telegramId, schema.users.telegramId))
      .where(
        and(
          eq(schema.alerts.active, true),
          // User must have API credentials
        )
      )

    // Group by user to minimize API calls
    const userAlerts = new Map<number, { user: User; alerts: Alert[] }>()
    for (const row of usersWithMarginAlerts) {
      if (!row.user.apiKey) continue // Skip users without credentials
      if (row.alert.type !== 'margin_below' && row.alert.type !== 'liquidation_distance')
        continue

      const existing = userAlerts.get(row.user.telegramId)
      if (existing) {
        existing.alerts.push(row.alert)
      } else {
        userAlerts.set(row.user.telegramId, { user: row.user, alerts: [row.alert] })
      }
    }

    // Check each user's positions
    for (const { user, alerts } of userAlerts.values()) {
      try {
        const client = new LNMarketsClient({
          credentials: {
            apiKey: user.apiKey!,
            apiSecret: user.apiSecret!,
            passphrase: user.passphrase!,
          },
        })

        const [positions, crossPosition, ticker] = await Promise.all([
          client.getOpenPositions(),
          client.getCrossPosition(),
          priceFeed.ticker,
        ])

        if (!ticker) continue

        for (const alert of alerts) {
          if (!this.shouldTrigger(alert)) continue

          if (alert.type === 'margin_below') {
            // Check isolated positions margin
            for (const pos of positions) {
              const marginPercent = ((pos.margin + pos.pl) / pos.margin) * 100
              if (marginPercent <= alert.targetValue) {
                await this.triggerAlert(alert, {
                  message: this.formatMarginAlert(alert, pos, marginPercent),
                })
              }
            }

            // Check cross margin
            if (crossPosition) {
              const marginPercent =
                ((crossPosition.margin + crossPosition.unrealizedPl) /
                  crossPosition.margin) *
                100
              if (marginPercent <= alert.targetValue) {
                await this.triggerAlert(alert, {
                  message: `⚠️ Cross margin at ${marginPercent.toFixed(1)}% (threshold: ${alert.targetValue}%)`,
                })
              }
            }
          }

          if (alert.type === 'liquidation_distance') {
            const currentPrice = ticker.lastPrice

            // Check isolated positions
            for (const pos of positions) {
              const distance =
                Math.abs(currentPrice - pos.liquidationPrice) / currentPrice * 100
              if (distance <= alert.targetValue) {
                await this.triggerAlert(alert, {
                  message: this.formatLiquidationAlert(alert, pos, distance, currentPrice),
                })
              }
            }

            // Check cross position
            if (crossPosition?.liquidationPrice) {
              const distance =
                Math.abs(currentPrice - crossPosition.liquidationPrice) / currentPrice * 100
              if (distance <= alert.targetValue) {
                await this.triggerAlert(alert, {
                  message: `🚨 Cross position liquidation ${distance.toFixed(1)}% away!\nCurrent: $${currentPrice.toLocaleString()}\nLiquidation: $${crossPosition.liquidationPrice.toLocaleString()}`,
                })
              }
            }
          }
        }
      } catch (error) {
        console.error(`Error checking alerts for user ${user.telegramId}:`, error)
      }
    }
  }

  private shouldTrigger(alert: Alert): boolean {
    if (!alert.lastTriggeredAt) return true
    const elapsed = Date.now() - alert.lastTriggeredAt.getTime()
    return elapsed >= COOLDOWN_MS
  }

  private async triggerAlert(
    alert: Alert,
    data: { message: string; price?: number; rate?: number }
  ): Promise<void> {
    try {
      await this.bot.api.sendMessage(alert.telegramId, data.message, {
        parse_mode: 'HTML',
      })

      // Update alert
      if (alert.repeating) {
        await db
          .update(schema.alerts)
          .set({ lastTriggeredAt: new Date() })
          .where(eq(schema.alerts.id, alert.id))
      } else {
        // Deactivate one-time alert
        await db
          .update(schema.alerts)
          .set({ active: false, lastTriggeredAt: new Date() })
          .where(eq(schema.alerts.id, alert.id))
      }

      console.log(`Alert ${alert.id} triggered for user ${alert.telegramId}`)
    } catch (error) {
      console.error(`Failed to send alert ${alert.id}:`, error)
    }
  }

  private formatPriceAlert(alert: Alert, price: number): string {
    const direction = alert.type === 'price_above' ? '📈 above' : '📉 below'
    return `🔔 <b>Price Alert</b>\n\nBTC is now ${direction} $${alert.targetValue.toLocaleString()}\n\nCurrent price: <b>$${price.toLocaleString()}</b>`
  }

  private formatFundingAlert(alert: Alert, rate: number): string {
    const direction = alert.type === 'funding_above' ? 'above' : 'below'
    const ratePercent = (rate * 100).toFixed(4)
    return `💰 <b>Funding Alert</b>\n\nFunding rate is now ${direction} ${alert.targetValue}%\n\nCurrent rate: <b>${ratePercent}%</b>`
  }

  private formatMarginAlert(
    alert: Alert,
    position: { side: string; entryPrice: number; leverage: number },
    marginPercent: number
  ): string {
    return `⚠️ <b>Margin Alert</b>\n\nYour ${position.side.toUpperCase()} position is at ${marginPercent.toFixed(1)}% margin\n\nEntry: $${position.entryPrice.toLocaleString()}\nLeverage: ${position.leverage}x\n\nConsider adding margin or closing the position.`
  }

  private formatLiquidationAlert(
    alert: Alert,
    position: { side: string; liquidationPrice: number; leverage: number },
    distance: number,
    currentPrice: number
  ): string {
    return `🚨 <b>Liquidation Warning</b>\n\nYour ${position.side.toUpperCase()} position is ${distance.toFixed(1)}% from liquidation!\n\nCurrent: $${currentPrice.toLocaleString()}\nLiquidation: $${position.liquidationPrice.toLocaleString()}\nLeverage: ${position.leverage}x\n\n<b>Take action now!</b>`
  }
}
