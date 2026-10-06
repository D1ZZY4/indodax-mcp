import Decimal from "decimal.js";

/**
 * Top-of-book arithmetic for the orderbook response.
 *
 * The exchange does not guarantee level ordering, so the best price is derived
 * rather than read from the first row. Every accessor returns `null` for an
 * empty or unreadable side instead of zero, because a zero bid or ask reads
 * as a real quote.
 */

type DepthLevel = [string | number, string];

/**
 * Price and size at the top of one side of the book.
 *
 * Both are computed together so a caller never has to re-scan the level list,
 * and both return null on an empty or unreadable side rather than zero.
 */
export function topOfBook(
  levels: DepthLevel[],
  side: "buy" | "sell",
): { price: Decimal; quantity: Decimal } | null {
  let best: { price: Decimal; quantity: Decimal } | null = null;
  for (const [rawPrice, rawQuantity] of levels) {
    let price: Decimal;
    let quantity: Decimal;
    try {
      price = new Decimal(String(rawPrice));
      quantity = new Decimal(String(rawQuantity));
    } catch {
      continue;
    }
    if (!price.isFinite() || !quantity.isFinite()) continue;
    if (best === null || (side === "buy" ? price.gt(best.price) : price.lt(best.price))) {
      best = { price, quantity };
    }
  }
  return best;
}

export function bestPrice(levels: DepthLevel[], side: "buy" | "sell"): Decimal | null {
  return topOfBook(levels, side)?.price ?? null;
}

export function bestQty(levels: DepthLevel[], side: "buy" | "sell"): Decimal | null {
  return topOfBook(levels, side)?.quantity ?? null;
}

/** Spread as a percentage of the mid, or null when either side is empty. */
export function spreadPctOf(bestBid: Decimal | null, bestAsk: Decimal | null): string | null {
  if (bestBid === null || bestAsk === null || bestBid.lte(0)) return null;
  return bestAsk.minus(bestBid).div(bestAsk.plus(bestBid).div(2)).mul(100).toFixed(2);
}

export function spreadOf(buy: DepthLevel[], sell: DepthLevel[]): string | null {
  const bestBid = bestPrice(buy, "buy");
  const bestAsk = bestPrice(sell, "sell");
  if (bestBid === null || bestAsk === null) return null;
  return bestAsk.minus(bestBid).toString();
}

export function midOf(buy: DepthLevel[], sell: DepthLevel[]): string | null {
  const bestBid = bestPrice(buy, "buy");
  const bestAsk = bestPrice(sell, "sell");
  if (bestBid === null || bestAsk === null) return null;
  return bestAsk.plus(bestBid).div(2).toString();
}
