import { EventEmitter } from 'events'
import { publicClient } from './lnmarkets.js'
import type { Ticker, FundingInfo } from '../types/index.js'

interface PriceFeedEvents {
  ticker: [Ticker]
  funding: [FundingInfo]
  error: [Error]
}

export class PriceFeed extends EventEmitter<PriceFeedEvents> {
  private intervalId?: ReturnType<typeof setInterval>
  private lastTicker?: Ticker
  private lastFunding?: FundingInfo
  private pollInterval: number

  constructor(pollIntervalMs = 5000) {
    super()
    this.pollInterval = pollIntervalMs
  }

  get currentPrice(): number | undefined {
    return this.lastTicker?.lastPrice
  }

  get currentFundingRate(): number | undefined {
    return this.lastFunding?.rate
  }

  get ticker(): Ticker | undefined {
    return this.lastTicker
  }

  get funding(): FundingInfo | undefined {
    return this.lastFunding
  }

  start(): void {
    if (this.intervalId) return

    // Initial fetch
    this.poll()

    // Poll at interval
    this.intervalId = setInterval(() => this.poll(), this.pollInterval)
    console.log(`Price feed started (polling every ${this.pollInterval}ms)`)
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = undefined
      console.log('Price feed stopped')
    }
  }

  private async poll(): Promise<void> {
    try {
      const [ticker, funding] = await Promise.all([
        publicClient.getTicker(),
        publicClient.getFunding(),
      ])

      this.lastTicker = ticker
      this.lastFunding = funding

      this.emit('ticker', ticker)
      this.emit('funding', funding)
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)))
    }
  }
}

// Singleton price feed
export const priceFeed = new PriceFeed(
  parseInt(process.env.ALERT_CHECK_INTERVAL || '5', 10) * 1000
)
