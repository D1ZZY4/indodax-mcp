import { describe, expect, it } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import type { PublicClient } from "@indodax-mcp/indodax-client";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { clearCache } from "@indodax-mcp/indodax-market";
import { buildIndodaxServer } from "../src/index.js";

function stubTicker(last: string) {
  return {
    ticker: async () => ({ high: last, low: last, last, buy: last, sell: last }),
  } as unknown as PublicClient;
}

describe("stop orders", () => {
  it("holds fire until the stop price crosses", async () => {
    const { server, app } = buildIndodaxServer(loadEnv({}));
    app.publicClient = stubTicker("2100000");
    const harness = await withInMemoryServer(server);
    try {
      const created = await harness.client.callTool({
        name: "indodax_stop_create",
        arguments: { pair: "btc_idr", side: "SELL", quantity: 0.01, stopPrice: 2000000 },
      });
      expect(created.isError).not.toBe(true);
      const idle = await harness.client.callTool({ name: "indodax_stop_check", arguments: {} });
      expect(idle.isError).not.toBe(true);
      const idleText = (idle.content as { type: string; text: string }[])[0]?.text ?? "{}";
      expect((JSON.parse(idleText) as { data: { fired: unknown[] } }).data.fired).toHaveLength(0);
      app.publicClient = stubTicker("1900000");
      clearCache();
      const fired = await harness.client.callTool({
        name: "indodax_stop_check",
        arguments: {},
      });
      const firedText = (fired.content as { type: string; text: string }[])[0]?.text ?? "{}";
      const rows = (JSON.parse(firedText) as { data: { fired: { status: string }[] } }).data.fired;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe("triggered");
      expect(app.paper.openOrders()).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it("requires acknowledgement for live stops", async () => {
    const { server } = buildIndodaxServer(loadEnv({}));
    const harness = await withInMemoryServer(server);
    try {
      const denied = await harness.client.callTool({
        name: "indodax_stop_create",
        arguments: { pair: "btc_idr", side: "SELL", quantity: 0.01, stopPrice: 1, mode: "live" },
      });
      expect(denied.isError).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("schedules stop autopoll only when configured", () => {
    const off = buildIndodaxServer(loadEnv({}));
    expect(off.app.scheduler.running).not.toContain("stop-autopoll");
    off.app.scheduler.stopAll();
    const on = buildIndodaxServer(loadEnv({ STOP_AUTOPOLL_MS: "60000" }));
    expect(on.app.scheduler.running).toContain("stop-autopoll");
    on.app.scheduler.stopAll();
  });

  it("restores stop snapshots and skips corrupt rows", () => {
    const { app } = buildIndodaxServer(loadEnv({}));
    app.stops.restore([
      {
        id: "stop-7",
        pair: "btc_idr",
        side: "SELL",
        quantity: 0.01,
        stopPrice: 100,
        limitPrice: 100,
        mode: "paper",
        status: "open",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      { nope: true },
    ]);
    expect(app.stops.list()).toHaveLength(1);
  });
});
