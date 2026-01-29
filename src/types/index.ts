export type AlertType =
  | 'price_above'
  | 'price_below'
  | 'funding_above'
  | 'funding_below'
  | 'margin_below'
  | 'liquidation_distance'
  | 'position_pnl'

export interface PriceAlert {
  type: 'price_above' | 'price_below'
  targetPrice: number
}

export interface FundingAlert {
  type: 'funding_above' | 'funding_below'
  targetRate: number
}

export interface MarginAlert {
  type: 'margin_below'
  thresholdPercent: number
}

export interface LiquidationAlert {
  type: 'liquidation_distance'
  distancePercent: number
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

export interface FundingInfo {
  rate: number
  nextFundingTime: Date
}
