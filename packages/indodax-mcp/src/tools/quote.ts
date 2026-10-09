import Decimal from "decimal.js";
import { ValidationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { toCompactPair } from "@indodax-mcp/indodax-market";
import { fail, ok, parseArgs } from "@indodax-mcp/mcp-app/respond";
import {
  canonicalPair,
  pairArg,
  priceArg,
  quantityArg,
  sideArg,
} from "@indodax-mcp/mcp-app/schemas";
import { defineTool } from "@indodax-mcp/mcp-app/tools/define";
import type { AppServices } from "@indodax-mcp/mcp-app/composition";

export type QuoteVerdict = "instant" | "parked" | "partial";

export interface QuoteRequest {
  pair: string;
  side: "BUY" | "SELL";
  quantity: number;
  price?: number | undefined;
}

interface BookLevel {
  price: Decimal;
  quantity: Decimal;
}

function sortedLevels(raw: [string | number, string][], side: "BUY" | "SELL"): BookLevel[] {
  const levels: BookLevel[] = [];
  for (const [price, quantity] of raw) {
    try {
      const parsedPrice = new Decimal(String(price));
      const parsedQty = new Decimal(String(quantity));
      if (parsedPrice.isFinite() && parsedPrice.gt(0) && parsedQty.isFinite() && parsedQty.gt(0)) {
        levels.push({ price: parsedPrice, quantity: parsedQty });
      }
    } catch {
      // unparseable level skipped
    }
  }
  // BUY walks asks low to high; SELL walks bids high to low.
  levels.sort((a, b) =>
    side === "BUY" ? a.price.comparedTo(b.price) : b.price.comparedTo(a.price),
  );
  return levels;
}

/**
 * Read-only pre-order fill estimation against the live order book. Never
 * places anything. Answers "instant at ~X" versus "parked" before the agent
 * commits to an order, so price debates settle in one call.
 */
export async function estimateFill(app: AppServices, request: QuoteRequest) {
  const pair = canonicalPair(request.pair);
  const book = await app.publicClient.depth(toCompactPair(pair));
  const levels = sortedLevels(
    (request.side === "BUY" ? book.sell : book.buy) as [string | number, string][],
    request.side,
  );
  if (levels.length === 0) {
    throw ValidationError(`no ${request.side === "BUY" ? "ask" : "bid"} liquidity for ${pair}`);
  }
  const best = levels[0] as BookLevel;
  const wanted = new Decimal(String(request.quantity));
  const limit = request.price === undefined ? null : new Decimal(String(request.price));

  let filled = new Decimal(0);
  let cost = new Decimal(0);
  for (const level of levels) {
    if (limit !== null) {
      const acceptable = request.side === "BUY" ? level.price.lte(limit) : level.price.gte(limit);
      if (!acceptable) break;
    }
    const take = Decimal.min(level.quantity, wanted.minus(filled));
    filled = filled.plus(take);
    cost = cost.plus(take.mul(level.price));
    if (filled.gte(wanted)) break;
  }

  const estimatedAvgPrice = filled.gt(0) ? cost.div(filled).toString() : null;
  // A limit price that fills nothing parks the whole order, even in a deep book.
  const verdict: QuoteVerdict = filled.gte(wanted)
    ? "instant"
    : filled.gt(0)
      ? "partial"
      : "parked";

  const opposite = (request.side === "BUY" ? book.buy : book.sell) as [string | number, string][];
  const bestOpposite = sortedLevels(opposite, request.side === "BUY" ? "SELL" : "BUY")[0];
  return {
    pair,
    side: request.side,
    quantity: wanted.toString(),
    requestedPrice: limit?.toString() ?? null,
    bestBid: (request.side === "BUY" ? bestOpposite?.price : best.price)?.toString() ?? null,
    bestAsk: (request.side === "BUY" ? best.price : bestOpposite?.price)?.toString() ?? null,
    estimatedAvgPrice,
    fillableQuantity: filled.toString(),
    verdict,
    note:
      verdict === "instant"
        ? "orderbook suggests an immediate fill around the estimate; not a fill guarantee"
        : verdict === "parked"
          ? "limit price is outside the book; the order would rest unfilled"
          : "book depth covers only part of the quantity; the rest would park",
  };
}

const quoteTool = defineTool(
  {
    name: "indodax_quote",
    title: "Quote fill",
    description:
      "Read-only, never places orders. Estimate a fill against the live order book before committing: instant with an average-price estimate, parked when the limit misses the book, or partial when depth is short. Args: pair, side BUY/SELL, quantity base units, optional price limit; omit price for a market-style estimate.",
    capability: "READ",
    riskClass: "read",
    environmentRequirement: "any",
    authRequirement: "none",
    destructive: false,
    idempotencyClass: "none",
    auditClass: "read",
  },
  {
    pair: pairArg,
    side: sideArg,
    quantity: quantityArg,
    price: priceArg.optional(),
  },
);

export function registerQuoteTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool(quoteTool);

  handlers.tools.set("indodax_quote", async (raw) => {
    try {
      const args = parseArgs(quoteTool.inputSchema, raw);
      return ok(await estimateFill(app, args));
    } catch (error) {
      return fail(error);
    }
  });
}
