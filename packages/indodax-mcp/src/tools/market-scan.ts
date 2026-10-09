import { z } from "zod";
import { asPair, parseSymbolFlexible } from "@indodax-mcp/core";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { fail, ok, parseArgs } from "@indodax-mcp/mcp-app/respond";
import { passesScreen, screenValues } from "@indodax-mcp/mcp-app/screen";
import { defineTool } from "@indodax-mcp/mcp-app/tools/define";
import type { AppServices } from "@indodax-mcp/mcp-app/composition";

/**
 * Bulk market screening scan.
 *
 * Separated from single-market reads because it owns the projection,
 * server-side screening bounds, and derived range/position/spread fields.
 * Single-pair tools answer one market; this one answers which markets are
 * worth a closer look.
 */

/** Projection for a scan: name only the fields the caller asked for. */
const TICKER_FIELDS = ["high", "low", "last", "buy", "sell", "vol_idr", "vol_btc"] as const;

/**
 * Default projection when `fields` is omitted.
 *
 * Screening needs range (high/low/last), spread (buy/sell), and volume
 * (vol_idr) in one call, so those six ride by default. An explicit `fields`
 * list is still honoured as given for callers counting every byte. Rows also
 * carry derived `rangePct`, `pos`, and `spreadPct` whenever their inputs are
 * usable, so a harness sorts and filters candidates without re-parsing
 * decimals per row.
 */
const TICKER_DEFAULT_FIELDS = ["last", "high", "low", "buy", "sell", "vol_idr"] as const;

type TickerRow = Record<string, string | number | undefined>;

const tickersAll = defineTool(
  {
    name: "indodax_tickers_all",
    title: "indodax_tickers_all",
    description:
      "Read-only. Screening-ready tickers. Args: optional quote filter like IDR, optional limit 1 to 500 default 100 when neither quote nor limit is given (limit caps returned rows, total is the universe size). Rows carry last, high, low, buy, sell, and vol_idr by default plus derived rangePct, pos, and spreadPct when computable. Args: optional fields array of high, low, last, buy, sell, vol_idr, vol_btc; optional pairs list to screen named markets without fetching the universe; optional minVolumeIdr floor on vol_idr; optional minRangePct floor on 24h range; optional maxSpreadPct cap; optional minPos/maxPos bounds on position inside the range.",
    capability: "READ" as const,
    riskClass: "read" as const,
    environmentRequirement: "any" as const,
    authRequirement: "none" as const,
    destructive: false,
    idempotencyClass: "none" as const,
    auditClass: "read" as const,
  },
  {
    quote: z.string().min(1).max(10).optional(),
    limit: z.number().int().min(1).max(500).optional(),
    /**
     * Minimum 24h quote volume. Scanning 475 pairs at once is heavy, and a
     * volume floor is the cheapest way to cut the set before fetching detail.
     * Applies to vol_idr rows; use it with quote IDR screening.
     */
    minVolumeIdr: z.number().nonnegative().optional(),
    /** Minimum 24h range percent of the low. Rows without a usable range fail. */
    minRangePct: z.number().nonnegative().optional(),
    /** Maximum spread percent of the bid. Rows without a usable spread fail. */
    maxSpreadPct: z.number().nonnegative().optional(),
    /** Minimum position of last inside high/low (0 to 1). */
    minPos: z.number().min(0).max(1).optional(),
    /** Maximum position of last inside high/low (0 to 1). */
    maxPos: z.number().min(0).max(1).optional(),
    /**
     * Screen only these pairs (any common spelling each). Unknown names are
     * reported in `unknown` rather than failing the scan, so monitoring three
     * positions never fetches 475 rows to keep two.
     */
    pairs: z.array(z.string().min(1)).max(100).optional(),
    /**
     * Restrict each row to these fields. Derived rangePct, pos, and spreadPct
     * ride along whenever their inputs are usable.
     */
    fields: z.array(z.enum(TICKER_FIELDS)).min(1).optional(),
  },
);

export function registerMarketScanTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool(tickersAll);

  handlers.tools.set("indodax_tickers_all", async (raw) => {
    try {
      const args = parseArgs(tickersAll.inputSchema, raw);
      const all = (await app.publicClient.tickerAll()) as { tickers: Record<string, TickerRow> };
      const total = Object.keys(all.tickers).length;
      let entries: [string, TickerRow][] = Object.entries(all.tickers);
      const unknown: string[] = [];
      if (args.pairs !== undefined) {
        // Named-market screening: keep only requested pairs, canonicalized,
        // so three positions never cost a 475-row fetch. Unknown names ride
        // along in `unknown` instead of failing the whole scan.
        const wanted = new Map<string, string>();
        for (const name of args.pairs) {
          const symbol = parseSymbolFlexible(name);
          if (symbol === null) {
            unknown.push(name);
            continue;
          }
          wanted.set(asPair(symbol), name);
        }
        const byLower = new Map(entries.map(([pair]) => [pair.toLowerCase(), pair]));
        const picked: [string, TickerRow][] = [];
        for (const [canonical, original] of wanted) {
          const actual = byLower.get(canonical);
          if (actual === undefined) {
            unknown.push(original);
            continue;
          }
          const body = all.tickers[actual];
          if (body !== undefined) picked.push([actual, body]);
        }
        entries = picked;
      }
      if (args.quote !== undefined) {
        const wanted = args.quote.toLowerCase();
        entries = entries.filter(([pair]) => pair.toLowerCase().endsWith(`_${wanted}`));
      }
      // All screening bounds combine with AND: a candidate must pass every
      // active floor or cap. Rows that cannot produce a needed value fail the
      // bound instead of passing silently as a false candidate.
      entries = entries.filter(([, body]) =>
        passesScreen(body as Record<string, unknown>, {
          ...(args.minVolumeIdr === undefined ? {} : { minVolumeIdr: args.minVolumeIdr }),
          ...(args.minRangePct === undefined ? {} : { minRangePct: args.minRangePct }),
          ...(args.maxSpreadPct === undefined ? {} : { maxSpreadPct: args.maxSpreadPct }),
          ...(args.minPos === undefined ? {} : { minPos: args.minPos }),
          ...(args.maxPos === undefined ? {} : { maxPos: args.maxPos }),
        }),
      );
      // Matched counts every row that passed the filters; count counts the
      // rows actually returned after the limit cap. Total is the universe the
      // exchange sent before any filtering.
      const matched = entries.length;
      const limit = args.limit ?? (args.quote === undefined ? 100 : undefined);
      if (limit !== undefined) entries = entries.slice(0, limit);
      const projection = args.fields ?? [...TICKER_DEFAULT_FIELDS];
      const wanted = new Set<string>(projection);
      entries = entries.map(([pair, body]): [string, TickerRow] => {
        const row: TickerRow = { pair };
        for (const field of TICKER_FIELDS) {
          const value = body[field];
          if (wanted.has(field) && value !== undefined) row[field] = value;
        }
        const screened = screenValues(body as Record<string, unknown>);
        if (screened.rangePct !== null) row.rangePct = screened.rangePct;
        if (screened.pos !== null) row.pos = screened.pos;
        if (screened.spreadPct !== null) row.spreadPct = screened.spreadPct;
        return [pair, row];
      }) as typeof entries;
      return ok({
        count: entries.length,
        matched,
        total,
        quote: args.quote ?? null,
        limit: limit ?? null,
        fields: projection,
        tickers: Object.fromEntries(entries),
        pairs: entries.map(([pair]) => pair),
        unknown,
        summary: `${entries.length} ticker(s) returned of ${matched} matched of ${total} total${args.quote ? ` filtered by ${args.quote}` : ""}, fields ${projection.join(",")}`,
      });
    } catch (error) {
      return fail(error);
    }
  });
}
