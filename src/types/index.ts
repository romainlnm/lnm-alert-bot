export type AlertType =
  // Simple price alerts
  | 'price_above'
  | 'price_below'
  // Smart alerts
  | 'percent_change'    // e.g., -5% in 1h
  | 'volatility'        // e.g., 3% move in 15min
  // Private alerts
  | 'margin_below'
  | 'liquidation_distance'

export interface PriceSnapshot {
  price: number
  timestamp: number
}

export interface SmartAlertConfig {
  percentChange: number   // e.g., -5 for -5%
  timeWindowMinutes: number  // e.g., 60 for 1 hour
}

export interface UserCredentials {
  apiKey: string
  apiSecret: string
  passphrase: string
}

export interface Position {
  id: string
  side: 'long' | 'short'
  quantity: number
  margin: number
  leverage: number
  entryPrice: number
  liquidationPrice: number
  pl: number
  plPercent: number
}

export interface Ticker {
  lastPrice: number
  bid: number
  ask: number
  high24h: number
  low24h: number
}
