import { z } from "zod";

export const serverTimeSchema = z.object({
  timezone: z.string(),
  server_time: z.number(),
});
export type ServerTime = z.infer<typeof serverTimeSchema>;

const decimalString = z.union([z.string(), z.number()]).transform((value) => String(value));

export const pairSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  base_currency: z.string(),
  traded_currency: z.string(),
  traded_currency_unit: z.string().optional(),
  description: z.string().optional(),
  ticker_id: z.string(),
  trade_min_base_currency: z.union([z.string(), z.number()]).optional(),
  trade_min_traded_currency: z.union([z.string(), z.number()]).optional(),
  price_precision: z.union([z.string(), z.number()]).optional(),
  quantity_increment: z.union([z.string(), z.number()]).optional(),
  trade_fee_percent: z.union([z.string(), z.number()]).optional(),
  trade_fee_percent_taker: z.union([z.string(), z.number()]).optional(),
  trade_fee_percent_maker: z.union([z.string(), z.number()]).optional(),
  is_maintenance: z.union([z.boolean(), z.number(), z.string()]).optional(),
  is_market_suspended: z.union([z.boolean(), z.number(), z.string()]).optional(),
});
export type PairInfo = z.infer<typeof pairSchema>;
export const pairsSchema = z.array(pairSchema);

export const tickerBodySchema = z.object({
  high: decimalString,
  low: decimalString,
  last: decimalString,
  buy: decimalString,
  sell: decimalString,
  server_time: z.union([z.string(), z.number()]).optional(),
});
export type TickerBody = z.infer<typeof tickerBodySchema>;

export const tickerResponseSchema = z.object({ ticker: tickerBodySchema });
export const tickerAllSchema = z.object({ tickers: z.record(z.string(), tickerBodySchema) });

export const tradeSchema = z.object({
  date: z.union([z.string(), z.number()]),
  price: decimalString,
  amount: decimalString,
  tid: z.union([z.string(), z.number()]),
  type: z.enum(["buy", "sell"]),
});
export const tradesSchema = z.array(tradeSchema);

export const depthLevelSchema = z.tuple([z.union([z.string(), z.number()]), decimalString]);
export const depthSchema = z.object({
  buy: z.array(depthLevelSchema),
  sell: z.array(depthLevelSchema),
});
export type Depth = z.infer<typeof depthSchema>;

export const summariesSchema = z.object({
  tickers: z.record(
    z.string(),
    tickerBodySchema.extend({
      vol_btc: decimalString.optional(),
      vol_idr: decimalString.optional(),
      name: z.string().optional(),
    }),
  ),
  prices_24h: z.record(z.string(), decimalString).optional(),
  prices_7d: z.record(z.string(), decimalString).optional(),
});

export const ohlcSchema = z.array(
  z.object({
    Time: z.number(),
    Open: z.number(),
    High: z.number(),
    Low: z.number(),
    Close: z.number(),
    Volume: decimalString,
  }),
);
export type OhlcBar = z.infer<typeof ohlcSchema>[number];
