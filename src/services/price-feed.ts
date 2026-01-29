import { EventEmitter } from 'events'
import { addPriceHistory, getPriceAtTime } from '../db/index.js'

const API_BASE = 'https://api.lnmarkets.com'

interface PriceFeedEvents {
  price: [number]
  error: [Error]
}

class PriceFeed extends EventEmitter<PriceFeedEvents> {
  private intervalId?: ReturnType<typeof setInterval>
  private _currentPrice: number = 0
  private priceCache: Array<{ price: number; timestamp: number }> = []

  get currentPrice(): number {
    return this._currentPrice
  }

  getPercentChange(minutesAgo: number): number | null {
    // Try in-memory cache first
    const targetTime = Date.now() - minutesAgo * 60 * 1000
    const cached = this.priceCache
      .filter((p) => p.timestamp <= targetTime)
      .sort((a, b) => b.timestamp - a.timestamp)[0]

    const oldPrice = cached?.price ?? getPriceAtTime(minutesAgo * 60)
    if (!oldPrice || !this._currentPrice) return null
    return ((this._currentPrice - oldPrice) / oldPrice) * 100
  }

  start(): void {
    if (this.intervalId) return
    this.poll()
    this.intervalId = setInterval(() => this.poll(), 5000)
    console.log('Price feed started')
  }

  stop(): void {
    if (this.intervalId) clearInterval(this.intervalId)
  }

  private async poll(): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/v2/futures/ticker`)
      const data = (await res.json()) as { lastPrice: number }
      this._currentPrice = data.lastPrice

      const now = Date.now()
      this.priceCache.push({ price: data.lastPrice, timestamp: now })

      // Keep 24h in memory
      const cutoff = now - 24 * 60 * 60 * 1000
      this.priceCache = this.priceCache.filter((p) => p.timestamp > cutoff)

      // Store to DB every minute
      if (this.priceCache.length % 12 === 0) {
        addPriceHistory(data.lastPrice)
      }

      this.emit('price', data.lastPrice)
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)))
    }
  }
}

export const priceFeed = new PriceFeed()
