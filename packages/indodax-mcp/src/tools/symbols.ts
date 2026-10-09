import { z } from "zod";
import type { PairInfo } from "@indodax-mcp/indodax-client";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { ValidationError } from "@indodax-mcp/errors";
import { getPairsCached } from "@indodax-mcp/indodax-market";
import { fail, ok, parseArgs } from "@indodax-mcp/mcp-app/respond";
import { defineTool } from "@indodax-mcp/mcp-app/tools/define";
import type { AppServices } from "@indodax-mcp/mcp-app/composition";

/**
 * Symbol lookup.
 *
 * A screener needs to turn a name into a real pair. Guessing produced errors
 * upstream because nothing could answer "is this ticker tradable here", so the
 * caller invented a variable and failed at evaluation time instead of learning
 * the pair does not exist. This tool resolves names against the live pair
 * list, which is the exchange's own definition of what can be traded.
 */

const SEARCH = defineTool(
  {
    name: "indodax_search_symbols",
    title: "Search symbols",
    description:
      "Read-only. Find tradable pairs by base asset, quote asset, or free text. Use this before any other tool when a ticker is unverified: it resolves a name against the live pair list so a nonexistent or misspelled symbol is reported here instead of failing later as an unknown pair. Args: query required free text such as btc, BTCIDR, or btc_idr; optional quote filter and limit 1 to 200 default 25.",
    capability: "READ",
    riskClass: "read",
    environmentRequirement: "any",
    authRequirement: "none",
    destructive: false,
    idempotencyClass: "none",
    auditClass: "read",
  },
  {
    query: z.string().min(1),
    quote: z.string().min(1).max(10).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  },
);

/** Normalize a user string into a comparable compact form such as `btcidr`. */
function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Fields read from the pair list. Declared loosely on purpose: the endpoint
 * carries more per market than a screen needs, and a strict schema would
 * reject the whole response over an unrelated field.
 */
interface PairLike {
  ticker_id?: string;
  id?: string;
  base_currency?: string;
  traded_currency?: string;
  price_precision?: string | number;
  quantity_increment?: string | number;
  trade_min_base_currency?: string | number;
  trade_min_traded_currency?: string | number;
  is_maintenance?: boolean | number | string;
  is_market_suspended?: boolean | number | string;
}

interface PairView {
  pair: string;
  tickerId: string;
  base: string;
  quote: string;
  baseCurrency: string;
  tradedCurrency: string;
  pricePrecision: string | null;
  quantityIncrement: string | null;
  tradeMinBase: string | null;
  tradeMinQuote: string | null;
  maintenance: boolean;
  suspended: boolean;
}

function toView(info: PairLike): PairView {
  // The public pair list names the fields counter-intuitively:
  // `base_currency` holds the traded asset and `traded_currency` holds the
  // base, so reading them the usual way yields a reversed pair such as
  // `idr_cng`. `ticker_id` is already `base_quote` and is used as the
  // authority, with the currency fields only for the per-asset detail.
  const tickerId = info.ticker_id ?? `${info.base_currency ?? ""}_${info.traded_currency ?? ""}`;
  const [rawBase = "", rawQuote = ""] = tickerId.split("_");
  const base = rawBase;
  const quote = rawQuote;
  const flag = (value: boolean | number | string | undefined): boolean => {
    if (value === undefined) return false;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    const text = value.trim().toLowerCase();
    return text !== "" && text !== "0" && text !== "false" && text !== "no";
  };
  return {
    pair: tickerId,
    tickerId,
    base,
    quote,
    baseCurrency: base.toLowerCase(),
    tradedCurrency: quote.toLowerCase(),
    pricePrecision: info.price_precision === undefined ? null : String(info.price_precision),
    quantityIncrement:
      info.quantity_increment === undefined ? null : String(info.quantity_increment),
    tradeMinBase:
      info.trade_min_base_currency === undefined ? null : String(info.trade_min_base_currency),
    tradeMinQuote:
      info.trade_min_traded_currency === undefined ? null : String(info.trade_min_traded_currency),
    maintenance: flag(info.is_maintenance),
    suspended: flag(info.is_market_suspended),
  };
}

export function registerSymbolTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool(SEARCH);

  handlers.tools.set("indodax_search_symbols", async (raw) => {
    try {
      const args = parseArgs(SEARCH.inputSchema, raw);
      const needle = compact(args.query);
      if (needle === "") throw ValidationError(`query has no searchable characters: ${args.query}`);
      const quote = args.quote === undefined ? null : compact(args.quote);

      let pairs: PairInfo[];
      try {
        pairs = await getPairsCached(app.publicClient);
      } catch (error) {
        throw ValidationError(
          "pair list unreachable, so no symbol can be verified; retry when the market API responds " +
            "rather than guessing a ticker",
          { safeMetadata: { cause: error instanceof Error ? error.message.slice(0, 200) : null } },
        );
      }

      // The live pair list is wider than the cached typed view, so narrow it to
      // the fields a caller needs instead of trusting a schema that would drop
      // precision and increment data for markets the endpoint documents.
      const views = (pairs as readonly PairLike[]).map(toView);
      const matched = views.filter((view) => {
        const candidates = [
          view.tickerId,
          view.pair,
          view.baseCurrency,
          compact(view.tickerId),
          compact(view.pair),
        ];
        return candidates.some((candidate) => candidate.includes(needle));
      });
      const filtered =
        quote === null ? matched : matched.filter((view) => view.tradedCurrency === quote);
      const limit = args.limit ?? 25;
      const rows = filtered.slice(0, limit);
      const tradable = filtered.filter((view) => !view.suspended && !view.maintenance);

      return ok({
        query: args.query,
        quoteFilter: args.quote ?? null,
        matched: filtered.length,
        tradable: tradable.length,
        returned: rows.length,
        pairs: rows,
        // Name the pairs that exist but cannot be traded, so a caller does not
        // treat a suspended market as a missing symbol.
        suspended: filtered.filter((v) => v.suspended || v.maintenance).map((v) => v.pair),
        note:
          filtered.length === 0
            ? `no pair matches ${args.query}; check indodax_pairs for the full list instead of guessing a ticker`
            : "use pair from this response as the pair argument for every other tool",
        summary:
          filtered.length === 0
            ? `no tradable pair matches ${args.query}`
            : `${filtered.length} pair(s) match ${args.query}, ${tradable.length} tradable, showing ${rows.length}`,
      });
    } catch (error) {
      return fail(error);
    }
  });
}
