import { describe, expect, it } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import type { PublicClient } from "@indodax-mcp/indodax-client";
import { clearCache } from "@indodax-mcp/indodax-market";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/mcp-app";
import { evaluateStops } from "@indodax-mcp/mcp-app/tools/stop";

type Harness = Awaited<ReturnType<typeof withInMemoryServer>>;

function stubTicker(last: string) {
  return {
    ticker: async () => ({ high: last, low: last, last, buy: last, sell: last }),
    pairs: async () => [],
  } as unknown as PublicClient;
}

async function dataOf(harness: Harness, name: string, args: Record<string, unknown> = {}) {
  const result = (await harness.client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  expect(result.isError).not.toBe(true);
  return (
    JSON.parse(result.content[0]?.text ?? "{}") as {
      data: { checked: number; fired: unknown[]; totalStops: number; openStops: number };
    }
  ).data;
}

/**
 * `checked` is the number a supervisor uses to confirm its stops were examined.
 * It was read from the full stop history, so it counted cancelled, triggered,
 * and failed stops that were never evaluated on this pass and grew without
 * bound as stops accumulated.
 */
describe("stop_check counts the stops it examined", () => {
  it("reports only the open stops it evaluated", async () => {
    clearCache();
    const built = buildIndodaxServer(loadEnv({}));
    built.app.scheduler.stopAll();
    built.app.publicClient = stubTicker("1000");
    const harness = await withInMemoryServer(built.server);
    try {
      // Quantity 1 at these prices is under the 10000 minimum notional, so a
      // size above it keeps the stop-creation path exercised as intended.
      for (const price of [900, 950, 990]) {
        const created = await harness.client.callTool({
          name: "indodax_stop_create",
          arguments: { pair: "btc_idr", side: "SELL", quantity: 20, stopPrice: price },
        });
        expect(created.isError).not.toBe(true);
      }
      const cancelled = await harness.client.callTool({
        name: "indodax_stop_cancel",
        arguments: { id: "stop-2" },
      });
      expect(cancelled.isError).not.toBe(true);

      const data = await dataOf(harness, "indodax_stop_check");
      expect(built.app.stops.list()).toHaveLength(2);
      expect(built.app.stops.list(true)).toHaveLength(3);
      expect(data.checked).toBe(2);
      expect(data.openStops).toBe(2);
      expect(data.totalStops).toBe(3);
    } finally {
      await harness.close();
    }
  });

  it("does not accumulate cancelled stops into the count", async () => {
    clearCache();
    const built = buildIndodaxServer(loadEnv({}));
    built.app.scheduler.stopAll();
    built.app.publicClient = stubTicker("1000");
    built.app.stops.add({
      pair: "btc_idr",
      side: "SELL",
      quantity: 1,
      stopPrice: 100,
      limitPrice: 100,
      mode: "paper",
    });
    built.app.stops.cancel("stop-1", "operator closed it");

    const first = await evaluateStops(built.app);
    expect(first.checked).toBe(0);

    built.app.stops.add({
      pair: "btc_idr",
      side: "SELL",
      quantity: 1,
      stopPrice: 200,
      limitPrice: 200,
      mode: "paper",
    });
    const second = await evaluateStops(built.app);
    expect(second.checked).toBe(1);
  });

  it("counts a fired stop on the pass that examined it", async () => {
    clearCache();
    const built = buildIndodaxServer(loadEnv({}));
    built.app.scheduler.stopAll();
    built.app.publicClient = stubTicker("1500");
    built.app.stops.add({
      pair: "btc_idr",
      side: "SELL",
      quantity: 0.01,
      stopPrice: 2000,
      limitPrice: 2000,
      mode: "paper",
    });
    const result = await evaluateStops(built.app);
    expect(result.checked).toBe(1);
    expect(result.fired).toHaveLength(1);

    // The stop is now triggered and no longer open, so the next pass sees none.
    const after = await evaluateStops(built.app);
    expect(after.checked).toBe(0);
  });
});
