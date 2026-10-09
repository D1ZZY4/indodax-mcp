import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { loadEnv } from "@d1zzy4-jethools/config";
import { clearCache } from "@d1zzy4-jethools/indodax-market";
import { withInMemoryServer } from "@d1zzy4-jethools/mcp-testing";
import type { PublicClient } from "@d1zzy4-jethools/indodax-client";
import { buildIndodaxServer } from "@d1zzy4-jethools/mcp-app";
import type { AppServices } from "@d1zzy4-jethools/mcp-app/composition";

type Harness = Awaited<ReturnType<typeof withInMemoryServer>>;

interface OcoData {
  status: string;
  partial: boolean;
  exitSide: "BUY" | "SELL";
  legs: { leg: string; ok: boolean; detail: { message?: string; side?: string } }[];
  entry: { side?: string } | null;
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
 * Paper economics for these tests: the ledger starts with 100M IDR and 1 BTC,
 * and the minimum notional is 10000. Quantity 0.5 keeps every leg affordable
 * on both sides (BUY needs quote, SELL needs base) and above the minimum.
 */
const QTY = 0.5;
const ENTRY = 30000;
const TAKE_PROFIT = 45000;
const STOP = 25000;

function bundleArgs(extra: Record<string, unknown> = {}) {
  return {
    pair: "btc_idr",
    side: "BUY",
    quantity: QTY,
    entryPrice: ENTRY,
    takeProfitPrice: TAKE_PROFIT,
    stopPrice: STOP,
    ...extra,
  };
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
      const data = await dataOf(harness, "indodax_oco_bundle", bundleArgs());
      expect(data.status).toBe("complete");
      expect(data.partial).toBe(false);
      expect(data.legs.every((leg) => leg.ok)).toBe(true);
      expect(built.app.paper.openOrders()).toHaveLength(2);
      expect(built.app.stops.list()).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it("exits opposite the entry: one BUY in, two SELLs out", async () => {
    // Regression for a live incident where the take-profit leg copied the
    // entry side and doubled the long instead of closing it. A BUY bundle
    // must produce exactly 1 BUY (entry) plus a SELL take profit and a SELL
    // stop, never 2 BUYs.
    const built = stubbed();
    const harness = await withInMemoryServer(built.server);
    try {
      const data = await dataOf(harness, "indodax_oco_bundle", bundleArgs());
      expect(data.exitSide).toBe("SELL");
      expect(data.entry?.side).toBe("BUY");
      const takeProfit = data.legs.find((leg) => leg.leg === "takeProfit");
      expect(takeProfit?.detail.side).toBe("SELL");
      const orders = built.app.paper.openOrders();
      expect(orders.filter((order) => order.side === "BUY")).toHaveLength(1);
      expect(orders.filter((order) => order.side === "SELL")).toHaveLength(1);
      expect(built.app.stops.list().at(0)?.side).toBe("SELL");
    } finally {
      await harness.close();
    }
  });

  it("mirrors a short the other way: one SELL in, two BUYs out", async () => {
    const built = stubbed();
    const harness = await withInMemoryServer(built.server);
    try {
      const data = await dataOf(
        harness,
        "indodax_oco_bundle",
        bundleArgs({ side: "SELL", entryPrice: ENTRY, takeProfitPrice: 20000, stopPrice: 35000 }),
      );
      expect(data.status).toBe("complete");
      expect(data.exitSide).toBe("BUY");
      expect(data.entry?.side).toBe("SELL");
      const takeProfit = data.legs.find((leg) => leg.leg === "takeProfit");
      expect(takeProfit?.detail.side).toBe("BUY");
      const orders = built.app.paper.openOrders();
      expect(orders.filter((order) => order.side === "SELL")).toHaveLength(1);
      expect(orders.filter((order) => order.side === "BUY")).toHaveLength(1);
      expect(built.app.stops.list().at(0)?.side).toBe("BUY");
    } finally {
      await harness.close();
    }
  });

  it("refuses the whole bundle when the stop cannot meet the minimum", async () => {
    // A stop at 15000 on 0.5 units is 7500 notional, below the 10000 floor.
    // Arming it anyway would report protection that fails at trigger time,
    // so the bundle must refuse before the entry opens a naked position.
    const built = stubbed();
    const harness = await withInMemoryServer(built.server);
    try {
      const failure = await harness.client.callTool({
        name: "indodax_oco_bundle",
        arguments: bundleArgs({ stopPrice: 15000 }),
      });
      expect(failure.isError).toBe(true);
      const body = JSON.parse(
        (failure.content as { type: string; text: string }[])[0]?.text ?? "{}",
      ) as { message: string };
      expect(body.message).toContain("stop leg notional");
      expect(body.message).toContain("MIN_ORDER_SIZE");
      expect(built.app.paper.openOrders()).toHaveLength(0);
      expect(built.app.stops.list(true)).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it("requires the stop on the loss side of the take profit per exit direction", async () => {
    const built = stubbed();
    const harness = await withInMemoryServer(built.server);
    try {
      const failure = await harness.client.callTool({
        name: "indodax_oco_bundle",
        arguments: bundleArgs({ side: "SELL", takeProfitPrice: TAKE_PROFIT, stopPrice: 800 }),
      });
      expect(failure.isError).toBe(true);
      const body = JSON.parse(
        (failure.content as { type: string; text: string }[])[0]?.text ?? "{}",
      ) as { message: string };
      expect(body.message).toContain("BUY exits");
    } finally {
      await harness.close();
    }
  });

  it("places the take profit when there is no entry leg", async () => {
    // Without an entry the legs follow side to protect an already-open
    // position: SELL exits close a long, so the stop still sits below target.
    const built = stubbed();
    const harness = await withInMemoryServer(built.server);
    try {
      const data = await dataOf(
        harness,
        "indodax_oco_bundle",
        bundleArgs({ side: "SELL", entryPrice: undefined }),
      );
      expect(data.status).toBe("complete");
      expect(data.exitSide).toBe("SELL");
      expect(built.app.paper.openOrders()).toHaveLength(1);
      expect(built.app.paper.openOrders().at(0)?.side).toBe("SELL");
      expect(built.app.stops.list().at(0)?.side).toBe("SELL");
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
        arguments: bundleArgs(),
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
      paper.ledger.balances.btc = "0";
    });
    const harness = await withInMemoryServer(built.server);
    try {
      const data = await dataOf(harness, "indodax_oco_bundle", bundleArgs());
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
      const data = await dataOf(harness, "indodax_oco_bundle", bundleArgs());
      expect(data.status).toBe("complete");
      const stop = built.app.stops.list().at(0);
      expect(stop?.linkedOrderId).toBeTruthy();
      // The linked id is the take-profit that actually rests on the ledger.
      const paperOrder = built.app.paper
        .openOrders()
        .find((order) => order.price === String(TAKE_PROFIT));
      expect(stop?.linkedOrderId).toBe(paperOrder?.exchangeOrderId);
    } finally {
      await harness.close();
    }
  });

  it("still arms the stop when the take-profit leg is refused", async () => {
    const built = stubbed((app) => {
      const paper = app.paper as unknown as { ledger: { balances: Record<string, string> } };
      paper.ledger.balances.btc = "0";
    });
    const harness = await withInMemoryServer(built.server);
    try {
      const data = await dataOf(harness, "indodax_oco_bundle", bundleArgs());
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
      await dataOf(
        harness,
        "indodax_oco_bundle",
        bundleArgs({ pair: "BTCIDR", side: "SELL", entryPrice: undefined }),
      );
      await harness.client.callTool({
        name: "indodax_stop_create",
        arguments: { pair: "BTC/IDR", side: "SELL", quantity: QTY, stopPrice: STOP },
      });
      const pairs = new Set(built.app.stops.list(true).map((stop) => stop.pair));
      expect([...pairs]).toEqual(["btc_idr"]);
    } finally {
      await harness.close();
    }
  });
});

describe("oco completion on take-profit fill", () => {
  it("cancels the linked stop when the paper take-profit fills", async () => {
    // The untested half of the OCO contract: a filled take-profit closes the
    // position, so a lingering stop would fire later into an empty position.
    // Live fills are not observed server-side, so this runs on paper only.
    const built = stubbed();
    const harness = await withInMemoryServer(built.server);
    try {
      const placed = await dataOf(harness, "indodax_oco_bundle", {
        ...bundleArgs(),
        clientOrderId: "oco-fire-path-1",
      });
      expect(placed.status).toBe("complete");
      const takeProfit = placed.legs.find((leg) => leg.leg === "takeProfit");
      expect(takeProfit?.ok).toBe(true);
      const exchangeId = (takeProfit?.detail as { exchangeOrderId?: string } | undefined)
        ?.exchangeOrderId;
      expect(exchangeId).toBeTruthy();
      const filled = (await harness.client.callTool({
        name: "indodax_paper_fill",
        arguments: { orderId: exchangeId as string, price: TAKE_PROFIT },
      })) as { content: { text: string }[]; isError?: boolean };
      expect(filled.isError).not.toBe(true);
      const body = JSON.parse(
        (filled.content as { type: string; text: string }[])[0]?.text ?? "{}",
      ) as { data: { completedStops: string[] } };
      expect(body.data.completedStops).toEqual([placed.stopId]);
      expect(built.app.stops.list(true).at(0)?.status).toBe("cancelled");
    } finally {
      await harness.close();
    }
  });
});
