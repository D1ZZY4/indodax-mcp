import { z } from "zod";
import Decimal from "decimal.js";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { getTicker, toCompactPair } from "@indodax-mcp/indodax-market";
import { fail, ok, parseArgs } from "@indodax-mcp/indodax-mcp/respond";
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

const tickersAll = defineTool(
  meta(
    "indodax_tickers_all",
    "Read-only. All tickers in one call for scans. Args: optional quote filter like IDR, optional limit 1 to 500 default 100 when neither quote nor limit is given. Large output without filters is capped by the default.",
  ),
  {
    quote: z.string().min(1).max(10).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  },
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
  tickersAll,
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
      return ok(await app.publicClient.pairs());
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_ticker", async (raw) => {
    try {
      const args = parseArgs(ticker.inputSchema, raw);
      return ok(await getTicker(app.publicClient, args.pair));
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_tickers_all", async (raw) => {
    try {
      const args = parseArgs(tickersAll.inputSchema, raw);
      const all = await app.publicClient.tickerAll();
      const total = Object.keys(all.tickers).length;
      let entries = Object.entries(all.tickers);
      if (args.quote !== undefined) {
        const wanted = args.quote.toLowerCase();
        entries = entries.filter(([pair]) => pair.toLowerCase().endsWith(`_${wanted}`));
      }
      const limit = args.limit ?? (args.quote === undefined ? 100 : undefined);
      if (limit !== undefined) entries = entries.slice(0, limit);
      return ok({
        count: entries.length,
        total,
        quote: args.quote ?? null,
        limit: limit ?? null,
        tickers: Object.fromEntries(entries),
        pairs: entries.map(([pair]) => pair),
        summary: `${entries.length} ticker(s) of ${total} total${args.quote ? ` filtered by ${args.quote}` : ""}`,
      });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_orderbook", async (raw) => {
    try {
      const args = parseArgs(orderbook.inputSchema, raw);
      const book = await app.publicClient.depth(toCompactPair(args.pair));
      const levels = Math.min(100, Math.max(1, Math.floor(args.levels ?? 20)));
      const buy = book.buy.slice(0, levels);
      const sell = book.sell.slice(0, levels);
      return ok({
        pair: canonicalPair(args.pair),
        levels,
        buy,
        sell,
        buyCount: buy.length,
        sellCount: sell.length,
        spread: spreadOf(buy, sell),
        mid: midOf(buy, sell),
        summary: `depth for ${canonicalPair(args.pair)} with ${buy.length} bid(s) and ${sell.length} ask(s)`,
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
      return ok({
        pair: canonicalPair(args.pair),
        count: sliced.length,
        total: tradeRows.length,
        limit: args.limit ?? null,
        trades: sliced,
        summary: `${sliced.length} recent trade(s) for ${canonicalPair(args.pair)}`,
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
      return ok(
        bars.map((bar) => ({
          Time: bar.Time,
          Open: String(bar.Open),
          High: String(bar.High),
          Low: String(bar.Low),
          Close: String(bar.Close),
          Volume: String(bar.Volume),
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

type DepthLevel = [string | number, string];

function bestPrice(levels: DepthLevel[], side: "buy" | "sell"): Decimal | null {
  let best: Decimal | null = null;
  for (const [price] of levels) {
    let value: Decimal;
    try {
      value = new Decimal(String(price));
    } catch {
      continue;
    }
    if (!value.isFinite()) continue;
    if (best === null || (side === "buy" ? value.gt(best) : value.lt(best))) best = value;
  }
  return best;
}

function spreadOf(buy: DepthLevel[], sell: DepthLevel[]): string | null {
  const bestBid = bestPrice(buy, "buy");
  const bestAsk = bestPrice(sell, "sell");
  if (bestBid === null || bestAsk === null) return null;
  return bestAsk.minus(bestBid).toString();
}

function midOf(buy: DepthLevel[], sell: DepthLevel[]): string | null {
  const bestBid = bestPrice(buy, "buy");
  const bestAsk = bestPrice(sell, "sell");
  if (bestBid === null || bestAsk === null) return null;
  return bestAsk.plus(bestBid).div(2).toString();
}
