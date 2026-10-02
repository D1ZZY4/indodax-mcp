import { z } from "zod";
import Decimal from "decimal.js";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { equityIdr } from "@indodax-mcp/indodax-portfolio";
import { fail, ok } from "../respond.js";
import type { AppServices } from "../composition.js";

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
      const prices = await livePrices();
      const holdings = Object.entries(state.balances).map(([asset, amount]) => ({
        asset,
        available: new Decimal(amount),
        locked: new Decimal(0),
      }));
      const priceMap = new Map(
        Object.entries(prices).map(([pair, last]) => [pair, new Decimal(last)]),
      );
      const { equity, positions } = equityIdr(holdings, priceMap);
      return ok({ balances: state.balances, equityIdr: equity.toString(), positions, prices });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_positions", async () => {
    try {
      const { state } = snapshot();
      return ok({ positions: state.orders.length, balances: state.balances });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_pnl", async () => {
    try {
      const { state } = snapshot();
      return ok({ tradeCount: state.tradeCount, totalFees: state.totalFees });
    } catch (error) {
      return fail(error);
    }
  });

  async function livePrices(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const code of Object.keys(app.paper.snapshot().balances)) {
      if (code === "idr") continue;
      try {
        const ticker = await app.publicClient.ticker(`${code}_idr`);
        out[`${code}_idr`] = ticker.last;
      } catch {
        // leave missing prices out rather than failing the tool
      }
    }
    return out;
  }
}
