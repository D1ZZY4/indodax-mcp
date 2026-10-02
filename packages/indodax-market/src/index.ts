import { asPair, parseSymbolFlexible, type SymbolParts } from "@indodax-mcp/core";
import { ValidationError } from "@indodax-mcp/errors";
import type { PublicClient, TickerBody } from "@indodax-mcp/indodax-client";
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
}
