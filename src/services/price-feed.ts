import { EventEmitter } from 'events'
import { db, schema } from '../db/index.js'
import { lt } from 'drizzle-orm'

const API_BASE = 'https://api.lnmarkets.com'

interface PriceFeedEvents {
  price: [number]
  error: [Error]
}

class PriceFeed extends EventEmitter<PriceFeedEvents> {
  private intervalId?: ReturnType<typeof setInterval>
  private historyCleanupId?: ReturnType<typeof setInterval>
  private _currentPrice: number = 0
  private priceHistory: Array<{ price: number; timestamp: number }> = []

  get currentPrice(): number {
    return this._currentPrice
  }

  // Get price from N minutes ago
  getPriceAtTime(minutesAgo: number): number | null {
    const targetTime = Date.now() - minutesAgo * 60 * 1000
    // Find closest price to target time
    const closest = this.priceHistory
      .filter((p) => p.timestamp <= targetTime)
      .sort((a, b) => b.timestamp - a.timestamp)[0]
    return closest?.price ?? null
  }

  // Calculate percent change over time window
  getPercentChange(minutesAgo: number): number | null {
    const oldPrice = this.getPriceAtTime(minutesAgo)
    if (!oldPrice || !this._currentPrice) return null
    return ((this._currentPrice - oldPrice) / oldPrice) * 100
  }

  start(): void {
    if (this.intervalId) return

    this.poll()
    this.intervalId = setInterval(() => this.poll(), 5000)

    // Load recent price history from DB
    this.loadHistory()

    // Clean old history every hour
    this.historyCleanupId = setInterval(() => this.cleanupHistory(), 60 * 60 * 1000)

    console.log('Price feed started')
  }

  stop(): void {
    if (this.intervalId) clearInterval(this.intervalId)
    if (this.historyCleanupId) clearInterval(this.historyCleanupId)
  }

  private async poll(): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/v2/futures/ticker`)
      const data = (await res.json()) as { lastPrice: number }
      this._currentPrice = data.lastPrice

      const now = Date.now()
      this.priceHistory.push({ price: data.lastPrice, timestamp: now })

      // Keep only last 24h in memory
      const cutoff = now - 24 * 60 * 60 * 1000
      this.priceHistory = this.priceHistory.filter((p) => p.timestamp > cutoff)

      // Store in DB (every minute is enough)
      if (this.priceHistory.length % 12 === 0) {
        await db.insert(schema.priceHistory).values({
          price: data.lastPrice,
          timestamp: new Date(now),
        })
      }

      this.emit('price', data.lastPrice)
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)))
    }
  }

  private async loadHistory(): Promise<void> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const rows = await db
      .select()
      .from(schema.priceHistory)
      .where(lt(schema.priceHistory.timestamp, cutoff))

    this.priceHistory = rows.map((r) => ({
      price: r.price,
      timestamp: r.timestamp.getTime(),
    }))
  }

  private async cleanupHistory(): Promise<void> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    await db.delete(schema.priceHistory).where(lt(schema.priceHistory.timestamp, cutoff))
  }
}

export const priceFeed = new PriceFeed()
