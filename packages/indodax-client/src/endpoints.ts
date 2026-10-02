export const PUBLIC_BASE = "https://indodax.com";

export const PublicApi = {
  SERVER_TIME: "/api/server_time",
  PAIRS: "/api/pairs",
  PRICE_INCREMENTS: "/api/price_increments",
  SUMMARIES: "/api/summaries",
  TICKER_ALL: "/api/ticker_all",
  OHLC_HISTORY: "/tradingview/history_v2",
  ticker: (pair: string): string => `/api/ticker/${pair}`,
  depth: (pair: string): string => `/api/depth/${pair}`,
  trades: (pair: string): string => `/api/trades/${pair}`,
} as const;
