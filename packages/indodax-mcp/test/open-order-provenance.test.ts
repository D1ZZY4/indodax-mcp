/**
 * Regression for the open-order count disagreement reported from a production
 * loop: indodax_open_orders appeared to omit a freshly placed order while two
 * other tools returned the correct set.
 *
 * Root cause established by inspection: none of the three tools caches. The
 * authenticated read path has no store, so a difference can only come from the
 * exchange propagating a place or cancel asynchronously. The fix is therefore
 * disclosure, not a cache change: every open-order surface now states when the
 * set was read and that the read is uncached, so a caller can distinguish a
 * stale local read from exchange propagation lag.
 */
import { describe, expect, it } from "vitest";
import { loadEnv } from "@d1zzy4-jethools/config";
import type { AccountClient } from "@d1zzy4-jethools/indodax-account";
import type { PublicClient } from "@d1zzy4-jethools/indodax-client";
import { clearCache } from "@d1zzy4-jethools/indodax-market";
import { withInMemoryServer } from "@d1zzy4-jethools/mcp-testing";
import { buildIndodaxServer } from "@d1zzy4-jethools/mcp-app";

const ORDERS = [
  { symbol: "HONEYIDR", orderId: 1, clientOrderId: "tp-1", side: "SELL", origQty: "10" },
  { symbol: "XRPIDR", orderId: 2, clientOrderId: "tp-2", side: "SELL", origQty: "20" },
];

function stubbed() {
  const built = buildIndodaxServer(loadEnv({ INDODAX_API_KEY: "k", INDODAX_API_SECRET: "s" }));
  built.app.scheduler.stopAll();
  built.app.accountClient = {
    getAccount: async () => ({
      canTrade: true,
      canWithdraw: false,
      balances: [{ asset: "IDR", free: "1000", locked: "0" }],
    }),
    openOrders: async () => ORDERS,
  } as unknown as AccountClient;
  built.app.publicClient = {
    pairs: async () => [],
    ticker: async () => ({ high: "1", low: "1", last: "1", buy: "1", sell: "1" }),
  } as unknown as PublicClient;
  clearCache();
  return built;
}

describe("open-order reads disclose provenance", () => {
  it("marks indodax_open_orders as an uncached live read with a timestamp", async () => {
    const built = stubbed();
    const harness = await withInMemoryServer(built.server);
    try {
      const result = (await harness.client.callTool({
        name: "indodax_open_orders",
        arguments: {},
      })) as { content: { text: string }[]; isError?: boolean };
      expect(result.isError).not.toBe(true);
      const data = (
        JSON.parse(result.content[0]?.text ?? "{}") as {
          data: { count: number; source: string; observedAt: string; note: string };
        }
      ).data;
      expect(data.count).toBe(2);
      expect(data.source).toBe("live");
      expect(Number.isNaN(Date.parse(data.observedAt))).toBe(false);
      expect(data.note).toContain("indodax_portfolio_snapshot");
    } finally {
      await harness.close();
    }
  });

  it("timestamps the snapshot open-order set from the same source", async () => {
    const built = stubbed();
    const harness = await withInMemoryServer(built.server);
    try {
      const result = (await harness.client.callTool({
        name: "indodax_portfolio_snapshot",
        arguments: {},
      })) as { content: { text: string }[]; isError?: boolean };
      expect(result.isError).not.toBe(true);
      const data = (
        JSON.parse(result.content[0]?.text ?? "{}") as {
          data: { openOrders: { count: number; observedAt: string } };
        }
      ).data;
      expect(data.openOrders.count).toBe(2);
      expect(Number.isNaN(Date.parse(data.openOrders.observedAt))).toBe(false);
    } finally {
      await harness.close();
      clearCache();
    }
  });

  it("keeps both open-order surfaces consistent when the exchange agrees", async () => {
    // With a stable exchange answer the two surfaces must match exactly; the
    // divergence the production report saw came from propagation timing, not
    // from one tool reading a different source.
    const built = stubbed();
    const harness = await withInMemoryServer(built.server);
    try {
      const read = async (name: string, args: Record<string, unknown>) => {
        const result = (await harness.client.callTool({ name, arguments: args })) as {
          content: { text: string }[];
        };
        return JSON.parse(result.content[0]?.text ?? "{}") as {
          data: { count?: number; openOrders?: { count: number } };
        };
      };
      const direct = await read("indodax_open_orders", {});
      const snapshot = await read("indodax_portfolio_snapshot", {});
      expect(direct.data?.count).toBe(snapshot.data?.openOrders?.count);
    } finally {
      await harness.close();
      clearCache();
    }
  });
});
