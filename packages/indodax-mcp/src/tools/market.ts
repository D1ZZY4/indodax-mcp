import { z } from "zod";
import {
  bestPrice,
  bestQty,
  midOf,
  spreadOf,
  spreadPctOf,
} from "@indodax-mcp/indodax-mcp/market-book";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { getTicker, toCompactPair } from "@indodax-mcp/indodax-market";
import { fail, ok, parseArgs } from "@indodax-mcp/indodax-mcp/respond";
import { decimalOrNull } from "@indodax-mcp/core";
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

/** Projection for a scan: name only the fields the caller asked for. */
const TICKER_FIELDS = ["high", "low", "last", "buy", "sell", "vol_idr", "vol_btc"] as const;

/**
 * Default projection when `fields` is omitted.
 *
 * The exchange sends roughly 475 pairs, each with the full body, which is
 * enough to flood a harness context on one unfiltered call. A scan almost
 * always wants price and volume, so those are the default. Callers that need
 * `high`, `low`, or the book still ask for them explicitly, and an explicit
 * empty selection is not possible because the schema requires at least one.
 */
const TICKER_DEFAULT_FIELDS = ["last", "vol_idr"] as const;

type TickerRow = Record<string, string | number | undefined>;

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
    "Read-only. Tickers for scans. Args: optional quote filter like IDR, optional limit 1 to 500 default 100 when neither quote nor limit is given. Rows carry only last and vol_idr unless fields asks for more, because the exchange sends the full body for roughly 475 pairs. Args: optional fields array of high, low, last, buy, sell, vol_idr, vol_btc.",
  ),
  {
    quote: z.string().min(1).max(10).optional(),
    limit: z.number().int().min(1).max(500).optional(),
    /**
     * Minimum 24h quote volume. Scanning 475 pairs at once is heavy, and a
     * volume floor is the cheapest way to cut the set before fetching detail.
     */
    minVolumeIdr: z.number().nonnegative().optional(),
    /**
     * Restrict each row to these fields. Omitting it keeps the full body for
     * compatibility.
     */
    fields: z.array(z.enum(TICKER_FIELDS)).min(1).optional(),
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
      const all = (await app.publicClient.tickerAll()) as { tickers: Record<string, TickerRow> };
      const total = Object.keys(all.tickers).length;
      let entries: [string, TickerRow][] = Object.entries(all.tickers);
      if (args.quote !== undefined) {
        const wanted = args.quote.toLowerCase();
        entries = entries.filter(([pair]) => pair.toLowerCase().endsWith(`_${wanted}`));
      }
      if (args.minVolumeIdr !== undefined) {
        const floor = args.minVolumeIdr;
        entries = entries.filter(([, body]) => {
          const volume = decimalOrNull(body.vol_idr ?? "");
          return volume?.gte(floor);
        });
      }
      const limit = args.limit ?? (args.quote === undefined ? 100 : undefined);
      if (limit !== undefined) entries = entries.slice(0, limit);
      // The default projection keeps an unfiltered scan small; an explicit
      // fields list is honoured as given, so nothing is silently hidden from a
      // caller that asked for detail.
      const projection = args.fields ?? [...TICKER_DEFAULT_FIELDS];
      const wanted = new Set<string>(projection);
      entries = entries.map(([pair, body]): [string, TickerRow] => {
        const row: TickerRow = { pair };
        for (const field of TICKER_FIELDS) {
          const value = body[field];
          if (wanted.has(field) && value !== undefined) row[field] = value;
        }
        return [pair, row];
      }) as typeof entries;
      return ok({
        count: entries.length,
        total,
        quote: args.quote ?? null,
        limit: limit ?? null,
        fields: projection,
        tickers: Object.fromEntries(entries),
        pairs: entries.map(([pair]) => pair),
        summary: `${entries.length} ticker(s) of ${total} total${args.quote ? ` filtered by ${args.quote}` : ""}, fields ${projection.join(",")}`,
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
