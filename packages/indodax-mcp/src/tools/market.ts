import { z } from "zod";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { getTicker, toCompactPair } from "@indodax-mcp/indodax-market";
import { fail, ok, pairArg, parseArgs } from "../respond.js";
import type { AppServices } from "../composition.js";

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

export function registerMarketTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  const defs: { metadata: ReturnType<typeof meta>; inputSchema: z.ZodType<unknown> }[] = [
    {
      metadata: meta(
        "indodax_server_time",
        "Read-only. Get the exchange server time for clock sync. Takes no arguments.",
      ),
      inputSchema: z.object({}),
    },
    {
      metadata: meta(
        "indodax_pairs",
        "Read-only. List every trading pair with minimums, precisions, and fees. Takes no arguments.",
      ),
      inputSchema: z.object({}),
    },
    {
      metadata: meta(
        "indodax_ticker",
        "Read-only. Live last price and 24h stats for one pair. Args: pair like btc_idr.",
      ),
      inputSchema: z.object({ pair: pairArg }),
    },
    {
      metadata: meta(
        "indodax_tickers_all",
        "Read-only. All tickers in one call for scans. Takes no arguments. Large output.",
      ),
      inputSchema: z.object({}),
    },
    {
      metadata: meta(
        "indodax_orderbook",
        "Read-only. Bid and ask depth for one pair. Args: pair, optional levels 1 to 100 default 20.",
      ),
      inputSchema: z.object({
        pair: pairArg,
        levels: z.number().int().min(1).max(100).optional(),
      }),
    },
    {
      metadata: meta("indodax_trades", "Read-only. Recent public trades for one pair. Args: pair."),
      inputSchema: z.object({ pair: pairArg }),
    },
    {
      metadata: meta(
        "indodax_candles",
        "Read-only. OHLCV candles for one pair. Args: symbol, timeframe minutes default 60, from and to unix seconds default last 24h.",
      ),
      inputSchema: z.object({
        symbol: z.string().min(1),
        timeframe: z.string().optional(),
        from: z.number().optional(),
        to: z.number().optional(),
      }),
    },
    {
      metadata: meta(
        "indodax_price_increments",
        "Read-only. Price increments per pair. Takes no arguments.",
      ),
      inputSchema: z.object({}),
    },
    {
      metadata: meta(
        "indodax_summaries",
        "Read-only. 24h and 7d market summaries. Takes no arguments.",
      ),
      inputSchema: z.object({}),
    },
  ];
  for (const def of defs) registry.registerTool({ ...def, outputSchema: undefined });

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
      const args = parseArgs(z.object({ pair: pairArg }), raw);
      return ok(await getTicker(app.publicClient, args.pair));
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_tickers_all", async () => {
    try {
      return ok(await app.publicClient.tickerAll());
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_orderbook", async (raw) => {
    try {
      const args = parseArgs(z.object({ pair: pairArg, levels: z.number().optional() }), raw);
      const book = await app.publicClient.depth(toCompactPair(args.pair));
      const levels = Math.min(100, Math.max(1, Math.floor(args.levels ?? 20)));
      return ok({ buy: book.buy.slice(0, levels), sell: book.sell.slice(0, levels) });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_trades", async (raw) => {
    try {
      const args = parseArgs(z.object({ pair: pairArg }), raw);
      return ok(await app.publicClient.trades(toCompactPair(args.pair)));
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_candles", async (raw) => {
    try {
      const args = parseArgs(
        z.object({
          symbol: z.string().min(1),
          timeframe: z.string().optional(),
          from: z.number().optional(),
          to: z.number().optional(),
        }),
        raw,
      );
      const now = Math.floor(Date.now() / 1000);
      const bars = await app.publicClient.ohlc(
        toCompactPair(args.symbol).toUpperCase(),
        args.timeframe ?? "60",
        args.from ?? now - 86_400,
        args.to ?? now,
      );
      return ok(bars);
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
