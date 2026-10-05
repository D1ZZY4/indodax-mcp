import { asCompact, asPair, parseSymbolFlexible, type SymbolParts } from "@indodax-mcp/core";
import { ValidationError } from "@indodax-mcp/errors";
import type { PairInfo, PublicClient, TickerBody } from "@indodax-mcp/indodax-client";
import { decimalOrNull } from "@indodax-mcp/core";
export interface MarketTicker extends TickerBody {
  symbol: SymbolParts;
  fetchedAt: string;
}

const STALE_AFTER_MS = 30_000;
const cache = new Map<string, { ticker: MarketTicker; at: number }>();

export function normalizePair(input: string): SymbolParts {
  const symbol = parseSymbolFlexible(input);
  if (!symbol) throw ValidationError(`invalid pair: ${input}`);
  return symbol;
}

/** Compact pair spelling required by depth, trades, and candles endpoints (e.g. btcidr). */
export function toCompactPair(input: string): string {
  return asCompact(normalizePair(input));
}

export async function getTicker(client: PublicClient, pair: string): Promise<MarketTicker> {
  const symbol = normalizePair(pair);
  const key = asPair(symbol);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < STALE_AFTER_MS) return cached.ticker;
  const body = await client.ticker(key);
  const ticker: MarketTicker = { ...body, symbol, fetchedAt: new Date().toISOString() };
  if (decimalOrNull(ticker.last) === null) throw ValidationError(`ticker missing last for ${key}`);
  cache.set(key, { ticker, at: Date.now() });
  return ticker;
}

export function cacheSize(): number {
  return cache.size;
}

export function clearCache(): void {
  cache.clear();
  pairsCache = null;
}

const PAIRS_STALE_AFTER_MS = 300_000;
/** Beyond this age a cached pair list is no longer trusted for halt verdicts. */
const PAIRS_MAX_STALE_MS = 1_800_000;
let pairsCache: { pairs: PairInfo[]; at: number } | null = null;

/**
 * Pair list with a short TTL so repeated order placements and suspension
 * checks share one fetch instead of hitting the public API on every call.
 * A failed refresh keeps serving the previous snapshot within a bounded
 * horizon; only a failure with no snapshot at all, or with a snapshot
 * older than the max horizon, propagates to the caller.
 */
export async function getPairsCached(client: PublicClient): Promise<PairInfo[]> {
  const cached = pairsCache;
  if (!cached || Date.now() - cached.at >= PAIRS_STALE_AFTER_MS) {
    try {
      pairsCache = { pairs: await client.pairs(), at: Date.now() };
      return pairsCache.pairs;
    } catch {
      if (!cached) throw new Error("pair list unreachable");
      if (Date.now() - cached.at > PAIRS_MAX_STALE_MS) {
        throw new Error("pair list stale beyond horizon");
      }
      return cached.pairs;
    }
  }
  return cached.pairs;
}

function flagOn(value: boolean | number | string | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = value.trim().toLowerCase();
  return text !== "" && text !== "0" && text !== "false" && text !== "no";
}

/**
 * Whether the exchange halted this market. Returns null when the pair
 * list is unreachable, the pair is absent, or the cached list is older
 * than the trust horizon, so callers skip the suspension check instead
 * of enforcing an outdated halt or inventing one.
 */
export async function isMarketSuspended(
  client: PublicClient,
  pair: string,
): Promise<boolean | null> {
  const symbol = normalizePair(pair);
  const wanted = new Set([
    asPair(symbol),
    asCompact(symbol),
    `${symbol.base}${symbol.quote}`.toUpperCase(),
  ]);
  let pairs: PairInfo[];
  try {
    pairs = await getPairsCached(client);
  } catch {
    return null;
  }
  return matchSuspended(pairs, wanted);
}

function matchSuspended(pairs: PairInfo[], wanted: Set<string>): boolean | null {
  const found = pairs.find((info) =>
    [info.ticker_id, info.id, info.symbol].some(
      (spell) => typeof spell === "string" && wanted.has(spell.toLowerCase()),
    ),
  );
  if (!found) return null;
  return flagOn(found.is_market_suspended) || flagOn(found.is_maintenance);
}

function findPair(pairs: PairInfo[], pair: string): PairInfo | null {
  const symbol = parseSymbolFlexible(pair);
  if (!symbol) return null;
  const wanted = new Set([
    asPair(symbol),
    asCompact(symbol),
    `${symbol.base}${symbol.quote}`.toUpperCase(),
  ]);
  return (
    pairs.find((info) =>
      [info.ticker_id, info.id, info.symbol].some(
        (spell) => typeof spell === "string" && wanted.has(spell.toLowerCase()),
      ),
    ) ?? null
  );
}

/**
 * Reject quantities the exchange would refuse for precision, with the
 * offending increment and a rounded suggestion, instead of an opaque
 * exchange error. Skips silently when the pair list is unreachable or the
 * pair/increment is unknown, so offline simulation keeps working.
 */
export async function checkQuantityIncrement(
  client: PublicClient,
  pair: string,
  quantity: number,
): Promise<void> {
  let pairs: PairInfo[];
  try {
    pairs = await getPairsCached(client);
  } catch {
    return;
  }
  const increment = decimalOrNull(findPair(pairs, pair)?.quantity_increment);
  const qty = decimalOrNull(quantity);
  if (increment === null || qty === null || increment.lte(0)) return;
  if (qty.mod(increment).isZero()) return;
  const rounded = qty.div(increment).round().mul(increment);
  const suggestion = rounded.gt(0) ? rounded : increment;
  throw ValidationError(
    `quantity ${qty.toString()} violates the ${pair} increment ${increment.toString()}; use a multiple such as ${suggestion.toString()}`,
  );
}
