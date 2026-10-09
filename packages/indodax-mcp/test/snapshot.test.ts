import { describe, expect, it } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import type { PublicClient } from "@indodax-mcp/indodax-client";
import { clearCache } from "@indodax-mcp/indodax-market";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/indodax-mcp";

const PAIRS = [
  {
    id: "w3fidr",
    symbol: "W3FIDR",
    ticker_id: "w3f_idr",
    base_currency: "idr",
    traded_currency: "w3f",
  },
];

function textOf(result: { content: { text: string }[] }): string {
  const block = result.content.at(0);
  if (block === undefined) throw new Error("expected a text content block");
  return block.text;
}

describe("portfolio snapshot", () => {
  it("composes balances, valuation, orders, stops, alerts, and deadman in one call", async () => {
    const built = buildIndodaxServer(loadEnv({}));
    built.app.scheduler.stopAll();
    built.app.accountClient = {
      getAccount: async () => ({
        canTrade: true,
        canWithdraw: false,
        balances: [
          { asset: "IDR", free: "100000", locked: "5000" },
          { asset: "W3F", free: "0.43", locked: "0" },
        ],
      }),
      openOrders: async () => [
        {
          orderId: "12076220",
          clientOrderId: "w3f-tp-001",
          symbol: "W3FIDR",
          side: "SELL",
          price: "25409",
          origQty: "0.43",
        },
      ],
    } as unknown as NonNullable<typeof built.app.accountClient>;
    built.app.publicClient = {
      pairs: async () => PAIRS,
      ticker: async (pair: string) =>
        pair === "w3f_idr"
          ? { high: "25000", low: "23000", last: "23572", buy: "23500", sell: "23600" }
          : { high: "1", low: "1", last: "1", buy: "1", sell: "1" },
    } as unknown as PublicClient;
    clearCache();
    const harness = await withInMemoryServer(built.server);
    try {
      const result = (await harness.client.callTool({
        name: "indodax_portfolio_snapshot",
        arguments: { entries: { W3F: "20000" } },
      })) as { content: { text: string }[]; isError?: boolean };
      expect(result.isError).not.toBe(true);
      const data = (JSON.parse(textOf(result)) as { data: Record<string, unknown> }).data as {
        idr: { free: string; locked: string; total: string };
        legs: { asset: string; unrealizedPct: string | null }[];
        totalIdr: string;
        openOrders: { count: number; orders: { side: string | null }[] };
        stops: { open: number; blocked: number };
        alerts: { active: number; triggered: number; cancelled: number; pairs: string[] };
        deadman: { state: string };
        summary: string;
      };
      expect(data.idr).toEqual({ free: "100000", locked: "5000", total: "105000" });
      const w3f = data.legs.find((leg) => leg.asset === "w3f");
      expect(w3f?.unrealizedPct).toBe("17.86");
      expect(data.totalIdr).toBe("115136");
      expect(data.openOrders.count).toBe(1);
      expect(data.openOrders.orders[0]?.side).toBe("SELL");
      expect(data.stops).toEqual({ open: 0, blocked: 0 });
      // A monitoring loop needs the retired counts, otherwise an alert that
      // fired and was already consumed looks identical to one never armed.
      expect(data.alerts).toEqual({ active: 0, triggered: 0, cancelled: 0, pairs: [] });
      expect(data.deadman.state).toBe("DISARMED");
      expect(data.summary).toContain("1 open order(s)");
    } finally {
      await harness.close();
      clearCache();
    }
  });

  it("counts retired alerts so a consumed trigger is still visible", async () => {
    // An alert retired by the scheduled autopoll leaves the active list. A loop
    // polling only `active` would read that as "nothing was ever armed", which
    // is the false negative the alert check reports.
    const built = buildIndodaxServer(loadEnv({}));
    built.app.scheduler.stopAll();
    built.app.accountClient = {
      getAccount: async () => ({
        canTrade: true,
        canWithdraw: false,
        balances: [{ asset: "IDR", free: "1000", locked: "0" }],
      }),
      openOrders: async () => [],
    } as unknown as NonNullable<typeof built.app.accountClient>;
    built.app.publicClient = {
      pairs: async () => [],
      ticker: async () => ({ high: "1", low: "1", last: "1", buy: "1", sell: "1" }),
    } as unknown as PublicClient;
    clearCache();
    built.app.alerts.add({ pair: "btc_idr", condition: { type: "above", price: "0.5" } });
    const { evaluateAlerts } = await import("@indodax-mcp/indodax-mcp/tools/alerts");
    await evaluateAlerts(built.app);

    const harness = await withInMemoryServer(built.server);
    try {
      const result = (await harness.client.callTool({
        name: "indodax_portfolio_snapshot",
        arguments: {},
      })) as { content: { text: string }[]; isError?: boolean };
      expect(result.isError).not.toBe(true);
      const data = (
        JSON.parse(textOf(result)) as {
          data: { alerts: { active: number; triggered: number } };
        }
      ).data;
      expect(data.alerts.active).toBe(0);
      expect(data.alerts.triggered).toBe(1);
    } finally {
      await harness.close();
      clearCache();
    }
  });

  it("denies the snapshot without credentials like every private read", async () => {
    const { server } = buildIndodaxServer(loadEnv({}));
    const harness = await withInMemoryServer(server);
    try {
      const result = (await harness.client.callTool({
        name: "indodax_portfolio_snapshot",
        arguments: {},
      })) as { content: { text: string }[]; isError?: boolean };
      expect(result.isError).toBe(true);
    } finally {
      await harness.close();
    }
  });
});
