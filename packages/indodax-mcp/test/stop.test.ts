import { describe, expect, it } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import type { PublicClient } from "@indodax-mcp/indodax-client";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { clearCache } from "@indodax-mcp/indodax-market";
import { buildIndodaxServer } from "@indodax-mcp/indodax-mcp";

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

  it("stores pairs canonically regardless of input spelling", async () => {
    const { server, app } = buildIndodaxServer(loadEnv({}));
    const harness = await withInMemoryServer(server);
    try {
      const created = await harness.client.callTool({
        name: "indodax_stop_create",
        arguments: { pair: "BTCIDR", side: "SELL", quantity: 10, stopPrice: 1000 },
      });
      expect(created.isError).not.toBe(true);
      expect(app.stops.list()[0]?.pair).toBe("btc_idr");
    } finally {
      await harness.close();
    }
  });

  it("auto-cancels OCO siblings when one stop fires", async () => {
    const { server, app } = buildIndodaxServer(loadEnv({}));
    app.publicClient = stubTicker("100");
    clearCache();
    const harness = await withInMemoryServer(server);
    try {
      for (const stopPrice of [100, 110]) {
        const created = await harness.client.callTool({
          name: "indodax_stop_create",
          arguments: {
            pair: "btc_idr",
            side: "BUY",
            quantity: 100,
            stopPrice,
            groupId: "tp-cut-1",
          },
        });
        expect(created.isError).not.toBe(true);
      }
      const checked = await harness.client.callTool({
        name: "indodax_stop_check",
        arguments: {},
      });
      const text = (checked.content as { type: string; text: string }[])[0]?.text ?? "{}";
      const body = JSON.parse(text) as {
        data: { fired: { id: string; status: string; cancelledSiblings?: string[] }[] };
      };
      expect(body.data.fired).toHaveLength(1);
      expect(body.data.fired[0]?.status).toBe("triggered");
      expect(body.data.fired[0]?.cancelledSiblings).toEqual(["stop-2"]);
      const history = app.stops.list(true);
      expect(history.find((stop) => stop.id === "stop-2")?.status).toBe("cancelled");
      expect(history.find((stop) => stop.id === "stop-2")?.reason).toContain("stop-1");
    } finally {
      await harness.close();
    }
  });

  it("leaves other groups alone when one group fires", async () => {
    const { server, app } = buildIndodaxServer(loadEnv({}));
    app.publicClient = stubTicker("100");
    clearCache();
    const harness = await withInMemoryServer(server);
    try {
      for (const [groupId, stopPrice] of [
        ["g1", 100],
        ["g2", 110],
      ] as [string, number][]) {
        const created = await harness.client.callTool({
          name: "indodax_stop_create",
          arguments: {
            pair: "btc_idr",
            side: "BUY",
            quantity: 100,
            stopPrice,
            groupId,
          },
        });
        expect(created.isError).not.toBe(true);
      }
      await harness.client.callTool({ name: "indodax_stop_check", arguments: {} });
      // g1 (stop 100) fires at 100; g2 (stop 110) does not cross and stays open.
      expect(app.stops.list().map((stop) => stop.id)).toEqual(["stop-2"]);
    } finally {
      await harness.close();
    }
  });
});

describe("percent stops and minimum refusal", () => {
  it("anchors percentDown to the live price for a SELL stop", async () => {
    const { server, app } = buildIndodaxServer(loadEnv({}));
    app.publicClient = stubTicker("100000");
    clearCache();
    const harness = await withInMemoryServer(server);
    try {
      const created = await harness.client.callTool({
        name: "indodax_stop_create",
        arguments: { pair: "btc_idr", side: "SELL", quantity: 0.5, percentDown: 5 },
      });
      expect(created.isError).not.toBe(true);
      const text = (created.content as { type: string; text: string }[])[0]?.text ?? "{}";
      const stop = (JSON.parse(text) as { data: { stop: { stopPrice: number } } }).data.stop;
      expect(stop.stopPrice).toBe(95000);
    } finally {
      await harness.close();
      clearCache();
    }
  });

  it("rejects a mismatched percent direction instead of arming backwards", async () => {
    const { server } = buildIndodaxServer(loadEnv({}));
    const harness = await withInMemoryServer(server);
    try {
      const denied = await harness.client.callTool({
        name: "indodax_stop_create",
        arguments: { pair: "btc_idr", side: "SELL", quantity: 0.5, percentUp: 5 },
      });
      expect(denied.isError).toBe(true);
      const text = (denied.content as { type: string; text: string }[])[0]?.text ?? "{}";
      expect(text).toContain("percentUp only arms BUY stops");
    } finally {
      await harness.close();
    }
  });

  it("refuses a sub-minimum stop with shortfall math instead of arming it", async () => {
    // A 0.05 BTC stop at 95000 is 4750 notional against the 10000 floor.
    // Arming it would report protection that fails at trigger time.
    const { server, app } = buildIndodaxServer(loadEnv({}));
    app.publicClient = stubTicker("100000");
    clearCache();
    const harness = await withInMemoryServer(server);
    try {
      const denied = await harness.client.callTool({
        name: "indodax_stop_create",
        arguments: { pair: "btc_idr", side: "SELL", quantity: 0.05, percentDown: 5 },
      });
      expect(denied.isError).toBe(true);
      const body = JSON.parse(
        (denied.content as { type: string; text: string }[])[0]?.text ?? "{}",
      ) as { message: string; safeMetadata?: { reason?: string; minQuantity?: string } };
      expect(body.message).toContain("UNDERMINIMUM_STOP");
      expect(body.message).toContain("5250");
      expect(body.safeMetadata?.reason).toBe("UNDERMINIMUM_STOP");
      expect(body.safeMetadata?.minQuantity).toBeTruthy();
      expect(app.stops.list(true)).toHaveLength(0);
    } finally {
      await harness.close();
      clearCache();
    }
  });
});

describe("trailing stops", () => {
  it("ratchets the trigger with favorable prints and fires from the extreme", async () => {
    const { server, app } = buildIndodaxServer(loadEnv({}));
    app.publicClient = stubTicker("100000");
    clearCache();
    const harness = await withInMemoryServer(server);
    try {
      const created = await harness.client.callTool({
        name: "indodax_stop_create",
        arguments: { pair: "btc_idr", side: "SELL", quantity: 0.5, trailingPct: 10 },
      });
      expect(created.isError).not.toBe(true);
      // Rally to 110000: nothing fires, but the extreme ratchets up so the
      // trigger trails at 99000 instead of the initial 90000.
      app.publicClient = stubTicker("110000");
      clearCache();
      const quiet = await harness.client.callTool({ name: "indodax_stop_check", arguments: {} });
      expect(quiet.isError).not.toBe(true);
      expect(app.stops.list().at(0)?.extremePrice).toBe("110000");
      // Dip to 98000 crosses the trailed 99000 trigger (not the 90000 arming
      // level), firing protection that followed the market up.
      app.publicClient = stubTicker("98000");
      clearCache();
      const fired = await harness.client.callTool({ name: "indodax_stop_check", arguments: {} });
      const text = (fired.content as { type: string; text: string }[])[0]?.text ?? "{}";
      const rows = (
        JSON.parse(text) as { data: { fired: { status: string; triggerPrice: number }[] } }
      ).data.fired;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe("triggered");
      expect(rows[0]?.triggerPrice).toBe(99000);
    } finally {
      await harness.close();
      clearCache();
    }
  });
});
