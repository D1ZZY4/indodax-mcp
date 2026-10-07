import { z } from "zod";
import { ValidationError } from "@indodax-mcp/errors";
import {
  bestPrice,
  bestQty,
  midOf,
  spreadOf,
  spreadPctOf,
} from "@indodax-mcp/indodax-mcp/market-book";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { getTicker, isPairTradable, toCompactPair } from "@indodax-mcp/indodax-market";
import { fail, ok, parseArgs } from "@indodax-mcp/indodax-mcp/respond";
import { flowOf, pairUnavailableMessage, screenValues } from "@indodax-mcp/indodax-mcp/screen";
import { canonicalPair, pairArg } from "@indodax-mcp/indodax-mcp/schemas";
import { defineTool } from "@indodax-mcp/indodax-mcp/tools/define";
import type { AppServices } from "@indodax-mcp/indodax-mcp/composition";

function meta(name: string, description: string) {
  return {
    name,
    title: name,
    description,
    capability: "READ" as const,
    riskClass: "read" as const,
    environmentRequirement: "any" as const,
    authRequirement: "none" as const,
    destructive: false,
    idempotencyClass: "none" as const,
    auditClass: "read" as const,
  };
}

const serverTime = defineTool(
  meta(
    "indodax_server_time",
    "Read-only. Get the exchange server time for clock sync. Takes no arguments.",
  ),
  {},
);

const pairs = defineTool(
  meta(
    "indodax_pairs",
    "Read-only. List every trading pair with minimums, precisions, and fees. Takes no arguments.",
  ),
  {},
);

const ticker = defineTool(
  meta(
    "indodax_ticker",
    "Read-only. Live last price and 24h stats for one pair. Args: pair like btc_idr.",
  ),
  { pair: pairArg },
);

const orderbook = defineTool(
  meta(
    "indodax_orderbook",
    "Read-only. Bid and ask depth for one pair. Args: pair, optional levels 1 to 100 default 20.",
  ),
  { pair: pairArg, levels: z.number().int().min(1).max(100).optional() },
);

const tradesTool = defineTool(
  meta(
    "indodax_trades",
    "Read-only. Recent public trades for one pair. Args: pair, optional limit 1 to 500 default all.",
  ),
  { pair: pairArg, limit: z.number().int().min(1).max(500).optional() },
);

const candles = defineTool(
  meta(
    "indodax_candles",
    "Read-only. OHLCV candles for one pair, money fields as strings. Args: symbol accepts any spelling like btc_idr or BTCIDR, timeframe minutes default 60 (60, 240, 1D, 3D, 1W also valid), from and to unix seconds default last 24h.",
  ),
  {
    symbol: z.string().min(1),
    timeframe: z.string().optional(),
    from: z.number().optional(),
    to: z.number().optional(),
  },
);

const priceIncrements = defineTool(
  meta("indodax_price_increments", "Read-only. Price increments per pair. Takes no arguments."),
  {},
);

const summaries = defineTool(
  meta("indodax_summaries", "Read-only. 24h and 7d market summaries. Takes no arguments."),
  {},
);

const MARKET_TOOLS = [
  serverTime,
  pairs,
  ticker,
  orderbook,
  tradesTool,
  candles,
  priceIncrements,
  summaries,
];

export function registerMarketTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  for (const def of MARKET_TOOLS) registry.registerTool(def);

  handlers.tools.set("indodax_server_time", async () => {
    try {
      return ok(await app.publicClient.serverTime());
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_pairs", async () => {
    try {
      const listed = await app.publicClient.pairs();
      // A suspended or maintenance market stays listed but refuses orders and
      // often serves an orderbook without bid/ask levels. Flag it here so a
      // screener skips it before spending calls on it.
      return ok(listed.map((info) => ({ ...info, tradable: isPairTradable(info) })));
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_ticker", async (raw) => {
    try {
      const args = parseArgs(ticker.inputSchema, raw);
      const snapshot = await getTicker(app.publicClient, args.pair);
      // Same derived fields as bulk rows so a single-pair read screens with
      // the same numbers: range and position from high/low/last, spread from
      // bid/ask. Depth in quote currency still needs indodax_orderbook or
      // indodax_quote, which read the live book instead of guessing it.
      const screened = screenValues(snapshot as unknown as Record<string, unknown>);
      return ok({
        ...snapshot,
        rangePct: screened.rangePct,
        pos: screened.pos,
        spreadPct: screened.spreadPct,
      });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_orderbook", async (raw) => {
    try {
      const args = parseArgs(orderbook.inputSchema, raw);
      let book: { buy: [string | number, string][]; sell: [string | number, string][] };
      try {
        book = (await app.publicClient.depth(toCompactPair(args.pair))) as typeof book;
      } catch (error) {
        // A delisted, suspended, or razor-thin market answers depth without
        // bid/ask arrays. The raw shape error names array paths, which reads
        // as a bug in the caller. Name the market and the verification step
        // so the harness skips it instead of retrying a market that cannot
        // quote.
        const cause = error instanceof Error ? error.message : String(error);
        if (/unexpected shape from \/api\/depth\//.test(cause)) {
          throw ValidationError(pairUnavailableMessage(args.pair, cause), {
            safeMetadata: { pair: args.pair, reason: "PAIR_UNAVAILABLE" },
          });
        }
        throw error;
      }
      const levels = Math.min(100, Math.max(1, Math.floor(args.levels ?? 20)));
      const buy = book.buy.slice(0, levels);
      const sell = book.sell.slice(0, levels);
      // Best bid and best ask are reported under the same names indodax_quote
      // uses. Without them a caller has to derive the top of book itself, and
      // the three spellings across ticker, orderbook, and quote invite a
      // silent zero when a harness reads a field that is not present.
      const bestBid = bestPrice(buy, "buy");
      const bestAsk = bestPrice(sell, "sell");
      const spread = spreadOf(buy, sell);
      const mid = midOf(buy, sell);
      return ok({
        pair: canonicalPair(args.pair),
        levels,
        buy,
        sell,
        buyCount: buy.length,
        sellCount: sell.length,
        bestBid: bestBid?.toString() ?? null,
        bestAsk: bestAsk?.toString() ?? null,
        bestBidQty: bestQty(buy, "buy")?.toString() ?? null,
        bestAskQty: bestQty(sell, "sell")?.toString() ?? null,
        spread,
        spreadPct: spreadPctOf(bestBid, bestAsk),
        mid,
        // An empty side is an empty book, not a price of zero.
        empty: buy.length === 0 || sell.length === 0,
        summary: `depth for ${canonicalPair(args.pair)} with ${buy.length} bid(s) and ${sell.length} ask(s)`,
        note:
          buy.length === 0 || sell.length === 0
            ? "one side of the book is empty; bestBid and bestAsk are null for that side rather than zero"
            : "bestBid and bestAsk match indodax_quote field names; use indodax_quote for a fill estimate before placing",
      });
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_trades", async (raw) => {
    try {
      const args = parseArgs(tradesTool.inputSchema, raw);
      const tradeRows = await app.publicClient.trades(toCompactPair(args.pair));
      const sliced = args.limit === undefined ? tradeRows : tradeRows.slice(0, args.limit);
      // Taker-flow summary in the response so a screening loop does not fetch
      // 100 trades per candidate and count sides by hand.
      const flow = flowOf(sliced.map((trade) => (trade.type === "buy" ? "buy" : "sell")));
      return ok({
        pair: canonicalPair(args.pair),
        count: sliced.length,
        total: tradeRows.length,
        limit: args.limit ?? null,
        trades: sliced,
        flow,
        ...(flow.flowWarning === null ? {} : { flowWarning: flow.flowWarning }),
        summary: `${sliced.length} recent trade(s) for ${canonicalPair(args.pair)} (${flow.buyCount} buys)`,
      });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_candles", async (raw) => {
    try {
      const args = parseArgs(candles.inputSchema, raw);
      const now = Math.floor(Date.now() / 1000);
      const bars = await app.publicClient.ohlc(
        toCompactPair(args.symbol).toUpperCase(),
        args.timeframe ?? "60",
        args.from ?? now - 86_400,
        args.to ?? now,
      );
      // Money always serializes as strings; the exchange sends OHLC numbers.
      /**
       * Lowercase field names with numeric mirrors, matching every other
       * market response. The exchange capitalises these fields, which made one
       * response the odd one out and forced a per-shape parser on the caller.
       */
      return ok(
        bars.map((bar) => ({
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
          note: "money fields are decimal strings, the Num fields are lossy mirrors for charting only",
        })),
      );
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_price_increments", async () => {
    try {
      const response = await app.publicClient.raw("/api/price_increments");
      return ok(response);
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_summaries", async () => {
    try {
      return ok(await app.publicClient.summaries());
    } catch (error) {
      return fail(error);
    }
  });
}
