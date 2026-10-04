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
let pairsCache: { pairs: PairInfo[]; at: number } | null = null;

function flagOn(value: boolean | number | string | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = value.trim().toLowerCase();
  return text !== "" && text !== "0" && text !== "false" && text !== "no";
}

/**
 * Whether the exchange halted this market. Returns null when the pair
 * list is unreachable or the pair is absent, so callers skip the
 * suspension check instead of inventing a halt.
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
  try {
    if (!pairsCache || Date.now() - pairsCache.at >= PAIRS_STALE_AFTER_MS) {
      pairsCache = { pairs: await client.pairs(), at: Date.now() };
    }
  } catch {
    return pairsCache ? matchSuspended(pairsCache.pairs, wanted) : null;
  }
  return matchSuspended(pairsCache.pairs, wanted);
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
