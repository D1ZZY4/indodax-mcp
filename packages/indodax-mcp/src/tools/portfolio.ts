import { z } from "zod";
import Decimal from "decimal.js";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { formatMoney } from "@indodax-mcp/core";
import { equityIdr, pnl } from "@indodax-mcp/indodax-portfolio";
import { fail, ok } from "@indodax-mcp/mcp-app/respond";
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

export function registerPortfolioTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool({
    metadata: {
      name: "indodax_portfolio",
      title: "Portfolio",
      description:
        "Read-only. Paper holdings valued at live prices with equity total. Takes no arguments.",
      ...READ,
    },
    inputSchema: z.object({}),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_positions",
      title: "Positions",
      description: "Read-only. Paper positions against initial balances with per-asset PnL.",
      ...READ,
    },
    inputSchema: z.object({}),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_pnl",
      title: "PnL",
      description: "Read-only. Total paper profit and loss in IDR at live prices.",
      ...READ,
    },
    inputSchema: z.object({}),
  });

  const snapshot = () => {
    const state = app.paper.snapshot();
    return { state };
  };

  handlers.tools.set("indodax_portfolio", async () => {
    try {
      const { state } = snapshot();
      const { prices, incomplete } = await livePrices();
      const holdings = Object.entries(state.balances).map(([asset, amount]) => ({
        asset,
        available: new Decimal(amount),
        locked: new Decimal(0),
      }));
      const priceMap = new Map(
        Object.entries(prices).map(([pair, last]) => [pair, new Decimal(last)]),
      );
      const { equity, positions } = equityIdr(holdings, priceMap);
      return ok({
        balances: state.balances,
        initialBalances: state.initialBalances,
        equityIdr: formatMoney(equity, 0),
        positions,
        positionCount: Object.keys(state.balances).length,
        prices,
        incomplete,
        tradeCount: state.tradeCount,
        totalFees: state.totalFees,
        checkedAt: new Date().toISOString(),
        summary: `equity ${formatMoney(equity, 0)} IDR across ${Object.keys(state.balances).length} asset(s)`,
      });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_positions", async () => {
    try {
      const { state } = snapshot();
      const initial = state.initialBalances;
      const { prices, incomplete } = await livePrices();
      const priceMap = new Map(
        Object.entries(prices).map(([pair, last]) => [pair, new Decimal(last)]),
      );
      const rows = Object.entries(state.balances).map(([asset, amount]) => {
        const current = new Decimal(amount);
        const start = new Decimal(initial[asset] ?? "0");
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
      return ok({
        count: rows.length,
        positions: rows,
        incomplete,
        summary: `${rows.length} position row(s) against initial balances`,
      });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_pnl", async () => {
    try {
      const { state } = snapshot();
      const { prices, incomplete } = await livePrices();
      const priceMap = new Map(
        Object.entries(prices).map(([pair, last]) => [pair, new Decimal(last)]),
      );
      let total = new Decimal(0);
      let valued = 0;
      for (const [asset, amount] of Object.entries(state.balances)) {
        const current = new Decimal(amount);
        const start = new Decimal(state.initialBalances[asset] ?? "0");
        const diff = pnl(current, start);
        if (asset === "idr") {
          total = total.plus(diff);
          valued += 1;
          continue;
        }
        const price = priceMap.get(`${asset}_idr`);
        if (!price) continue;
        total = total.plus(diff.mul(price));
        valued += 1;
      }
      return ok({
        tradeCount: state.tradeCount,
        totalFees: state.totalFees,
        pnlIdr: formatMoney(total, 2),
        valuedAssets: valued,
        totalAssets: Object.keys(state.balances).length,
        incomplete,
        prices,
        summary: `PnL ${formatMoney(total, 2)} IDR across ${valued} valued asset(s), fees ${state.totalFees}`,
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
