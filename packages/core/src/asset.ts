const ASSET_PATTERN = /^[a-z0-9]{1,16}$/;
const DEFAULT_QUOTES = ["usdt", "usdc", "idr", "btc", "eth"] as const;

export function normalizeAsset(code: string): string | null {
  const normalized = code.trim().toLowerCase();
  if (!ASSET_PATTERN.test(normalized)) return null;
  return normalized;
}

export interface SymbolParts {
  base: string;
  quote: string;
}

export function parseSymbol(pair: string): SymbolParts | null {
  const normalized = pair.trim().toLowerCase().replace(/[-/]/g, "_");
  const parts = normalized.split("_");
  if (parts.length !== 2) return null;
  const [base, quote] = parts as [string, string];
  if (normalizeAsset(base) === null || normalizeAsset(quote) === null) return null;
  return { base, quote };
}

export function parseSymbolFlexible(
  pair: string,
  quotes: readonly string[] = DEFAULT_QUOTES,
): SymbolParts | null {
  const direct = parseSymbol(pair);
  if (direct !== null) return direct;
  const compact = pair.trim().toLowerCase().replace(/[-/_]/g, "");
  for (const quote of quotes) {
    if (compact.endsWith(quote) && compact.length > quote.length) {
      const base = compact.slice(0, compact.length - quote.length);
      if (normalizeAsset(base) !== null) return { base, quote };
    }
  }
  return null;
}

export function asPair(symbol: SymbolParts): string {
  return `${symbol.base}_${symbol.quote}`;
}

export function asCompact(symbol: SymbolParts): string {
  return `${symbol.base}${symbol.quote}`;
}
