import { z } from "zod";
import Decimal from "decimal.js";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { formatMoney } from "@indodax-mcp/core";
import { equityIdr, pnl } from "@indodax-mcp/indodax-portfolio";
import { fail, ok, parseArgs } from "@indodax-mcp/mcp-app/respond";
import { defineTool } from "@indodax-mcp/mcp-app/tools/define";
import type { AppServices } from "@indodax-mcp/mcp-app/composition";

const READ = {
  capability: "READ" as const,
  riskClass: "read" as const,
  environmentRequirement: "any" as const,
  authRequirement: "none" as const,
  destructive: false,
  idempotencyClass: "none" as const,
  auditClass: "read" as const,
};

/**
 * One tool for the three paper valuation reads.
 *
 * `portfolio`, `positions`, and `pnl` all called the same local `livePrices()`
 * helper over the same `app.paper.snapshot()`, and `pnl` emitted fields that
 * `positions` already computed. A `view` argument replaces the two absorbed
 * tools; every view still carries the asset rows so nothing is unreachable.
 */
const portfolio = defineTool(
  {
    name: "indodax_portfolio",
    title: "Portfolio",
    description:
      "Read-only. Paper holdings valued at live prices. Absorbs the former indodax_positions and indodax_pnl. Args: view selects the emphasis. summary (default) returns equity in IDR plus the prices used. positions returns one row per asset with current, initial, per-asset PnL, and valueIdr. pnl returns the total PnL in IDR with the valued and unpriced counts. Every view includes positions and incomplete, so a leg that cannot be priced is visible in all of them and is never valued at zero.",
    ...READ,
  },
  {
    view: z.enum(["summary", "positions", "pnl"]).optional().describe("Default summary"),
  },
);

export function registerPortfolioTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool(portfolio);

  handlers.tools.set("indodax_portfolio", async (raw) => {
    try {
      const args = parseArgs(portfolio.inputSchema, raw);
      const view = args.view ?? "summary";
      const state = app.paper.snapshot();
      const { prices, incomplete } = await livePrices();
      const priceMap = new Map(
        Object.entries(prices).map(([pair, last]) => [pair, new Decimal(last)]),
      );
      const rows = Object.entries(state.balances).map(([asset, amount]) => {
        const current = new Decimal(amount);
        const start = new Decimal(state.initialBalances[asset] ?? "0");
        const price = asset === "idr" ? new Decimal(1) : (priceMap.get(`${asset}_idr`) ?? null);
        return {
          asset,
          current: current.toString(),
          initial: start.toString(),
          pnl: formatMoney(pnl(current, start), 2),
          valueIdr: price === null ? null : formatMoney(current.mul(price), 0),
          price: price?.toString() ?? null,
        };
      });
      const { equity, positions } = equityIdr(
        Object.entries(state.balances).map(([asset, amount]) => ({
          asset,
          available: new Decimal(amount),
          locked: new Decimal(0),
        })),
        priceMap,
      );
      // Recomputed from the rows rather than from a second pass, so the total
      // and the per-leg numbers can never disagree.
      let totalPnl = new Decimal(0);
      let valued = 0;
      for (const row of rows) {
        const price = row.asset === "idr" ? new Decimal(1) : priceMap.get(`${row.asset}_idr`);
        if (price === undefined) continue;
        totalPnl = totalPnl.plus(new Decimal(row.pnl).mul(price));
        valued += 1;
      }
      const base = {
        view,
        balances: state.balances,
        positions: rows,
        incomplete,
        prices,
        tradeCount: state.tradeCount,
        totalFees: state.totalFees,
      };
      if (view === "positions") {
        return ok({
          ...base,
          count: rows.length,
          summary: `${rows.length} position row(s) against initial balances`,
        });
      }
      if (view === "pnl") {
        return ok({
          ...base,
          pnlIdr: formatMoney(totalPnl, 2),
          equityIdr: formatMoney(equity, 0),
          valuedAssets: valued,
          totalAssets: Object.keys(state.balances).length,
          summary: `PnL ${formatMoney(totalPnl, 2)} IDR across ${valued} valued asset(s), fees ${state.totalFees}`,
        });
      }
      return ok({
        ...base,
        initialBalances: state.initialBalances,
        equityIdr: formatMoney(equity, 0),
        positionCount: Object.keys(state.balances).length,
        positionCountValued: positions,
        pnlIdr: formatMoney(totalPnl, 2),
        summary: `equity ${formatMoney(equity, 0)} IDR across ${Object.keys(state.balances).length} asset(s)`,
      });
    } catch (error) {
      return fail(error);
    }
  });

  async function livePrices(): Promise<{ prices: Record<string, string>; incomplete: string[] }> {
    const prices: Record<string, string> = {};
    const incomplete: string[] = [];
    for (const code of Object.keys(app.paper.snapshot().balances)) {
      if (code === "idr") continue;
      try {
        const ticker = await app.publicClient.ticker(`${code}_idr`);
        prices[`${code}_idr`] = ticker.last;
      } catch {
        incomplete.push(code);
      }
    }
    return { prices, incomplete };
  }
}
