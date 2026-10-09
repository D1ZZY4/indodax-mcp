import { z } from "zod";
import { fail, ok, parseArgs } from "@indodax-mcp/mcp-app/respond";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { canonicalPair } from "@indodax-mcp/mcp-app/schemas";
import { toCompactPair } from "@indodax-mcp/indodax-market";
import { defineTool } from "@indodax-mcp/mcp-app/tools/define";
import type { AppServices } from "@indodax-mcp/mcp-app/composition";

/**
 * Candle series for one pair.
 *
 * Separate from the single-market reads because it is the one market response
 * that carries a time window and a timeframe rather than a snapshot, and
 * because its accepted timeframes are narrower than a free string.
 */

/**
 * Timeframes the exchange accepts on /tradingview/history_v2.
 *
 * Verified against the live endpoint on 2026-10-09: 1, 3, 5, 15, 30, 60, 120,
 * 240, 1D, 3D, 1W and 1M answer 200, while 2, 4H, 1H, D, 2D, 7D, 180, 360,
 * 720 and 1440 answer 400 "invalid TimeFrame". The enum turns that rejected
 * set into a local validation error instead of a wasted round trip, and stops a
 * caller assuming cron-style aliases exist on this venue.
 */
const CANDLE_TIMEFRAMES = [
  "1",
  "3",
  "5",
  "15",
  "30",
  "60",
  "120",
  "240",
  "1D",
  "3D",
  "1W",
  "1M",
] as const;

export const candleTimeframes = CANDLE_TIMEFRAMES;

const candles = defineTool(
  {
    name: "indodax_candles",
    title: "Candles",
    description:
      `Read-only. OHLCV candles for one pair, money fields as strings. Args: symbol accepts any ` +
      `spelling like btc_idr or BTCIDR; timeframe defaults to 60 and accepts only ` +
      `${CANDLE_TIMEFRAMES.join(", ")}, where the numeric values are minutes and the suffixed ` +
      `values are day, week and month candles; from and to unix seconds default last 24h. ` +
      `Returns pair, timeframe, from, to, count and bars, where each bar uses lowercase time, ` +
      `open, high, low, close and volume with lossy Num mirrors.`,
    capability: "READ",
    riskClass: "read",
    environmentRequirement: "any",
    authRequirement: "none",
    destructive: false,
    idempotencyClass: "none",
    auditClass: "read",
  },
  {
    symbol: z.string().min(1),
    timeframe: z
      .enum(CANDLE_TIMEFRAMES)
      .optional()
      .describe("Exchange-supported candle size; aliases such as 1H or 4H are rejected"),
    from: z.number().optional(),
    to: z.number().optional(),
  },
);

export function registerCandlesTool(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool(candles);

  handlers.tools.set("indodax_candles", async (raw) => {
    try {
      const args = parseArgs(candles.inputSchema, raw);
      const now = Math.floor(Date.now() / 1000);
      const pair = canonicalPair(args.symbol);
      const timeframe = args.timeframe ?? "60";
      const from = args.from ?? now - 86_400;
      const to = args.to ?? now;
      const bars = await app.publicClient.ohlc(
        toCompactPair(args.symbol).toUpperCase(),
        timeframe,
        from,
        to,
      );
      /**
       * Lowercase field names with numeric mirrors, matching every other market
       * response. The exchange capitalises these fields, which made one response
       * the odd one out and forced a per-shape parser on the caller.
       *
       * The pair, timeframe and window ride once at the top rather than on every
       * bar: a bare array left a caller unable to attribute the rows, and
       * repeating the note per row multiplied it across the whole payload.
       */
      return ok({
        pair,
        timeframe,
        from,
        to,
        count: bars.length,
        bars: bars.map((bar) => ({
          time: bar.Time,
          open: String(bar.Open),
          high: String(bar.High),
          low: String(bar.Low),
          close: String(bar.Close),
          volume: String(bar.Volume),
          closeNum: Number(bar.Close),
          openNum: Number(bar.Open),
          highNum: Number(bar.High),
          lowNum: Number(bar.Low),
          volumeNum: Number(bar.Volume),
        })),
        note: "time is unix seconds; money fields are decimal strings and the Num fields are lossy mirrors for charting only",
        summary: `${bars.length} ${timeframe} candle(s) for ${pair}`,
      });
    } catch (error) {
      return fail(error);
    }
  });
}
