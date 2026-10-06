import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { loadEnv } from "@indodax-mcp/config";
import { clearCache } from "@indodax-mcp/indodax-market";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import type { PublicClient } from "@indodax-mcp/indodax-client";
import { buildIndodaxServer } from "@indodax-mcp/indodax-mcp";
import type { AppServices } from "@indodax-mcp/indodax-mcp/composition";

type Harness = Awaited<ReturnType<typeof withInMemoryServer>>;

interface OcoData {
  status: string;
  partial: boolean;
  legs: { leg: string; ok: boolean; detail: { message?: string } }[];
  stopId: string | null;
}

async function dataOf(
  harness: Harness,
  name: string,
  args: Record<string, unknown>,
): Promise<OcoData> {
  const result = (await harness.client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  expect(result.isError).not.toBe(true);
  return (JSON.parse(result.content[0]?.text ?? "{}") as { data: OcoData }).data;
}

function stubbed(mutate?: (app: AppServices) => void) {
  clearCache();
  const built = buildIndodaxServer(loadEnv({}));
  built.app.scheduler.stopAll();
  built.app.publicClient = {
    ticker: async () => ({ high: "1000", low: "1000", last: "1000", buy: "1000", sell: "1000" }),
    pairs: async () => [],
  } as unknown as PublicClient;
  mutate?.(built.app);
  return built;
}

/**
 * The bundle places several legs from one decision, so the 5s inter-order
 * cooldown used to refuse every leg after the first. That produced the exact
 * half-protected outcome the tool exists to prevent: an open position with no
 * take profit, reported only as `partial: true`.
 */
describe("oco bundle leg placement", () => {
  it("places the entry and the take profit in one call", async () => {
    const built = stubbed();
    const harness = await withInMemoryServer(built.server);
    try {
      const data = await dataOf(harness, "indodax_oco_bundle", {
        pair: "btc_idr",
        side: "BUY",
        quantity: 10,
        entryPrice: 1000,
        takeProfitPrice: 1500,
        stopPrice: 800,
      });
      expect(data.status).toBe("complete");
      expect(data.partial).toBe(false);
      expect(data.legs.every((leg) => leg.ok)).toBe(true);
      expect(built.app.paper.openOrders()).toHaveLength(2);
      expect(built.app.stops.list()).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it("places the take profit when there is no entry leg", async () => {
    const built = stubbed();
    const harness = await withInMemoryServer(built.server);
    try {
      const data = await dataOf(harness, "indodax_oco_bundle", {
        pair: "btc_idr",
        side: "BUY",
        quantity: 10,
        takeProfitPrice: 1500,
        stopPrice: 800,
      });
      expect(data.status).toBe("complete");
      expect(built.app.paper.openOrders()).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it("still enforces the minimum notional on a continuation leg", async () => {
    // The cooldown exemption must not become a limit exemption.
    const built = stubbed((app) => {
      app.limits.minOrderNotional = new Decimal("999999999");
    });
    const harness = await withInMemoryServer(built.server);
    try {
      const failure = await harness.client.callTool({
        name: "indodax_oco_bundle",
        arguments: {
          pair: "btc_idr",
          side: "BUY",
          quantity: 10,
          entryPrice: 1000,
          takeProfitPrice: 1500,
          stopPrice: 800,
        },
      });
      expect(failure.isError).toBe(true);
      const body = JSON.parse(
        (failure.content as { type: string; text: string }[])[0]?.text ?? "{}",
      ) as { message: string };
      expect(body.message).toContain("MIN_ORDER_SIZE");
      expect(built.app.paper.openOrders()).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it("still enforces the balance check on a continuation leg", async () => {
    const built = stubbed((app) => {
      const paper = app.paper as unknown as { ledger: { balances: Record<string, string> } };
      paper.ledger.balances.idr = "11000";
    });
    const harness = await withInMemoryServer(built.server);
    try {
      const data = await dataOf(harness, "indodax_oco_bundle", {
        pair: "btc_idr",
        side: "BUY",
        quantity: 10,
        entryPrice: 1000,
        takeProfitPrice: 1500,
        stopPrice: 800,
      });
      expect(data.partial).toBe(true);
      const failed = data.legs.find((leg) => !leg.ok);
      expect(failed?.detail.message).toContain("INSUFFICIENT_BALANCE");
    } finally {
      await harness.close();
    }
  });

  it("links the stop to the take-profit it placed", async () => {
    // The take-profit reserves the quantity, so an unlinked stop would be
    // refused with -2010 on every trigger. The bundle is the one path that can
    // create both halves, so it must create the link too.
    const built = stubbed();
    const harness = await withInMemoryServer(built.server);
    try {
      const data = await dataOf(harness, "indodax_oco_bundle", {
        pair: "btc_idr",
        side: "BUY",
        quantity: 10,
        entryPrice: 1000,
        takeProfitPrice: 1500,
        stopPrice: 800,
      });
      expect(data.status).toBe("complete");
      const stop = built.app.stops.list().at(0);
      expect(stop?.linkedOrderId).toBeTruthy();
      // The linked id is the take-profit that actually rests on the ledger.
      const paperOrder = built.app.paper.openOrders().find((order) => order.price === "1500");
      expect(stop?.linkedOrderId).toBe(paperOrder?.exchangeOrderId);
    } finally {
      await harness.close();
    }
  });

  it("still arms the stop when the take-profit leg is refused", async () => {
    const built = stubbed((app) => {
      const paper = app.paper as unknown as { ledger: { balances: Record<string, string> } };
      paper.ledger.balances.idr = "11000";
    });
    const harness = await withInMemoryServer(built.server);
    try {
      const data = await dataOf(harness, "indodax_oco_bundle", {
        pair: "btc_idr",
        side: "BUY",
        quantity: 10,
        entryPrice: 1000,
        takeProfitPrice: 1500,
        stopPrice: 800,
      });
      expect(data.partial).toBe(true);
      // No take-profit rests, so there is nothing to link and the stop still
      // protects the position it just opened.
      const stop = built.app.stops.list().at(0);
      expect(stop?.linkedOrderId).toBeUndefined();
      expect(stop?.status).toBe("open");
    } finally {
      await harness.close();
    }
  });

  it("stores the stop under the canonical pair like every other stop path", async () => {
    // The bundle used to store the raw spelling, so an OCO stop created with
    // BTCIDR sat under a different key than one created with btc_idr and the
    // OCO group comparison never matched.
    const built = stubbed();
    const harness = await withInMemoryServer(built.server);
    try {
      await dataOf(harness, "indodax_oco_bundle", {
        pair: "BTCIDR",
        side: "BUY",
        quantity: 10,
        takeProfitPrice: 1500,
        stopPrice: 800,
      });
      await harness.client.callTool({
        name: "indodax_stop_create",
        arguments: { pair: "BTC/IDR", side: "SELL", quantity: 10, stopPrice: 1000 },
      });
      const pairs = new Set(built.app.stops.list(true).map((stop) => stop.pair));
      expect([...pairs]).toEqual(["btc_idr"]);
    } finally {
      await harness.close();
    }
  });
});
