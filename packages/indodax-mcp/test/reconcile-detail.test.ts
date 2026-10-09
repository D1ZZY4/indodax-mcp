import { describe, expect, it } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import type { PublicClient } from "@indodax-mcp/indodax-client";
import { clearCache } from "@indodax-mcp/indodax-market";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/mcp-app";

async function dataOf(call: Promise<unknown>) {
  const result = (await call) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  expect(result.isError).not.toBe(true);
  return JSON.parse(result.content[0]?.text ?? "{}") as { data: never };
}

function stubTicker(last: string) {
  return {
    ticker: async () => ({ high: last, low: last, last, buy: last, sell: last }),
    pairs: async () => [],
  } as unknown as PublicClient;
}

describe("reconcile explicit reasons", () => {
  it("balances rows carry values so MISMATCH is explainable", async () => {
    const built = buildIndodaxServer(loadEnv({}));
    built.app.accountClient = {
      getAccount: async () => ({
        canTrade: false,
        canWithdraw: false,
        balances: [{ asset: "IDR", free: "1", locked: "0" }],
      }),
    } as unknown as NonNullable<typeof built.app.accountClient>;
    const harness = await withInMemoryServer(built.server);
    try {
      const envelope = (await dataOf(
        harness.client.callTool({ name: "indodax_reconcile_balances", arguments: {} }),
      )) as {
        data: { balances: { asset: string; state: string; paper: string; exchange: string }[] };
      };
      const body = envelope.data;
      expect(body.balances[0]?.state).toBe("MISMATCH");
      expect(body.balances[0]?.paper).toBeDefined();
      expect(body.balances[0]?.exchange).toBeDefined();
    } finally {
      await harness.close();
    }
  });

  it("full report names failed legs with reasons, never bare UNKNOWN", async () => {
    const built = buildIndodaxServer(loadEnv({}));
    built.app.accountClient = {
      getAccount: async () => {
        throw new Error("exchange account unreadable");
      },
      openOrders: async () => {
        throw new Error("exchange orders unreadable");
      },
      myTrades: async () => ({ data: [] }),
    } as unknown as NonNullable<typeof built.app.accountClient>;
    const harness = await withInMemoryServer(built.server);
    try {
      const envelope = (await dataOf(
        harness.client.callTool({
          name: "indodax_reconcile_full",
          arguments: { symbol: "btcidr" },
        }),
      )) as {
        data: {
          exchange: { observed: string; observedReasons: string[] };
          unknownLegs: string[];
          unknownLegDetail: { leg: string; reason: string }[];
        };
      };
      const body = envelope.data;
      expect(body.exchange.observed).toBe("UNKNOWN");
      expect(body.exchange.observedReasons.length).toBeGreaterThan(0);
      expect(body.unknownLegs).toContain("openOrders");
      expect(body.unknownLegDetail[0]?.reason).toContain("unreadable");
    } finally {
      await harness.close();
    }
  });

  it("order rows explain fillability with compared values", async () => {
    const built = buildIndodaxServer(loadEnv({}));
    built.app.publicClient = stubTicker("900");
    clearCache();
    const harness = await withInMemoryServer(built.server);
    try {
      const placed = await harness.client.callTool({
        name: "indodax_paper_order",
        arguments: { pair: "btc_idr", side: "BUY", price: 1000, quantity: 100 },
      });
      expect(placed.isError).not.toBe(true);
      const envelope = (await dataOf(
        harness.client.callTool({ name: "indodax_reconcile_orders", arguments: {} }),
      )) as {
        data: {
          checked: number;
          orders: { orderId: string; fillable: boolean; reason: string; market: string }[];
        };
      };
      expect(envelope.data.checked).toBe(1);
      expect(envelope.data.orders[0]?.fillable).toBe(true);
      expect(envelope.data.orders[0]?.reason).toContain("900");
      expect(envelope.data.orders[0]?.reason).toContain("1000");
    } finally {
      await harness.close();
    }
  });

  it("order rows name unreadable markets instead of bare unfillable", async () => {
    const built = buildIndodaxServer(loadEnv({}));
    const harness = await withInMemoryServer(built.server);
    try {
      const placed = await harness.client.callTool({
        name: "indodax_paper_order",
        arguments: { pair: "btc_idr", side: "BUY", price: 1000, quantity: 100 },
      });
      expect(placed.isError).not.toBe(true);
      built.app.publicClient = {
        ticker: async () => {
          throw new Error("offline");
        },
      } as unknown as PublicClient;
      clearCache();
      const envelope = (await dataOf(
        harness.client.callTool({ name: "indodax_reconcile_orders", arguments: {} }),
      )) as {
        data: { orders: { fillable: boolean; reason: string }[] };
      };
      expect(envelope.data.orders[0]?.fillable).toBe(false);
      expect(envelope.data.orders[0]?.reason).toContain("btc_idr");
    } finally {
      await harness.close();
    }
  });
});
