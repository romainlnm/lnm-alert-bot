import type { Ticker, Position, FundingInfo, UserCredentials } from '../types/index.js'

const API_BASE = 'https://api.lnmarkets.com'

interface LNMarketsClientOptions {
  credentials?: UserCredentials
}

export class LNMarketsClient {
  private credentials?: UserCredentials

  constructor(options: LNMarketsClientOptions = {}) {
    this.credentials = options.credentials
  }

  private async fetch<T>(
    path: string,
    options: RequestInit = {},
    authenticated = false
  ): Promise<T> {
    const url = `${API_BASE}${path}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    }

    if (authenticated && this.credentials) {
      const timestamp = Date.now().toString()
      const method = options.method || 'GET'
      const body = options.body || ''

      // LN Markets uses HMAC-SHA256 for authentication
      const message = timestamp + method + path + body
      const signature = await this.sign(message, this.credentials.apiSecret)

      headers['LNM-ACCESS-KEY'] = this.credentials.apiKey
      headers['LNM-ACCESS-PASSPHRASE'] = this.credentials.passphrase
      headers['LNM-ACCESS-TIMESTAMP'] = timestamp
      headers['LNM-ACCESS-SIGNATURE'] = signature
    }

    const response = await fetch(url, { ...options, headers })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`LN Markets API error: ${response.status} - ${error}`)
    }

    return response.json()
  }

  private async sign(message: string, secret: string): Promise<string> {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
    return Buffer.from(signature).toString('base64')
  }

  // Public endpoints (no auth required)

  async getTicker(): Promise<Ticker> {
    const data = await this.fetch<{
      lastPrice: number
      bid: number
      offer: number
      high: number
      low: number
    }>('/v2/futures/ticker')

    return {
      lastPrice: data.lastPrice,
      bid: data.bid,
      ask: data.offer,
      high24h: data.high,
      low24h: data.low,
    }
  }

  async getFunding(): Promise<FundingInfo> {
    const data = await this.fetch<{
      rate: number
      nextFundingTime: number
    }>('/v2/futures/market')

    return {
      rate: data.rate,
      nextFundingTime: new Date(data.nextFundingTime),
    }
  }

  // Private endpoints (auth required)

  async getBalance(): Promise<{ balance: number; available: number }> {
    if (!this.credentials) throw new Error('Authentication required')

    const data = await this.fetch<{ balance: number; available: number }>(
      '/v2/user',
      {},
      true
    )
    return { balance: data.balance, available: data.available }
  }

  async getOpenPositions(): Promise<Position[]> {
    if (!this.credentials) throw new Error('Authentication required')

    const data = await this.fetch<
      Array<{
        id: string
        side: 's' | 'b'
        quantity: number
        margin: number
        leverage: number
        price: number
        liquidation: number
        pl: number
      }>
    >('/v2/futures?type=running', {}, true)

    return data.map((p) => ({
      id: p.id,
      side: p.side === 'b' ? 'long' : 'short',
      quantity: p.quantity,
      margin: p.margin,
      leverage: p.leverage,
      entryPrice: p.price,
      liquidationPrice: p.liquidation,
      pl: p.pl,
      plPercent: (p.pl / p.margin) * 100,
    }))
  }

  async getCrossPosition(): Promise<{
    margin: number
    unrealizedPl: number
    liquidationPrice: number | null
  } | null> {
    if (!this.credentials) throw new Error('Authentication required')

    const data = await this.fetch<{
      margin: number
      unrealized_pl: number
      liquidation_price: number | null
    } | null>('/v2/futures/cross/position', {}, true)

    if (!data || data.margin === 0) return null

    return {
      margin: data.margin,
      unrealizedPl: data.unrealized_pl,
      liquidationPrice: data.liquidation_price,
    }
  }
}

// Singleton for public API calls
export const publicClient = new LNMarketsClient()
