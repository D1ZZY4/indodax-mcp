import { describe, expect, it } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import type { PublicClient } from "@indodax-mcp/indodax-client";
import { clearCache } from "@indodax-mcp/indodax-market";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/indodax-mcp";
import { evaluateAlerts } from "@indodax-mcp/indodax-mcp/tools/alerts";

function stubTicker(last: string) {
  return {
    ticker: async () => ({ high: last, low: last, last, buy: last, sell: last }),
    pairs: async () => [],
  } as unknown as PublicClient;
}

async function dataOf(call: Promise<unknown>) {
  const result = (await call) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  expect(result.isError).not.toBe(true);
  const text = result.content[0]?.text ?? "{}";
  return (JSON.parse(text) as { data: unknown }).data;
}

describe("alert autopoll", () => {
  it("fires active alerts against live prices without a tool call", async () => {
    const { app } = buildIndodaxServer(loadEnv({}));
    app.publicClient = stubTicker("200");
    clearCache();
    app.alerts.add({ pair: "btc_idr", condition: { type: "above", price: "100" } });
    const first = await evaluateAlerts(app);
    expect(first.checked).toBe(1);
    expect(first.triggered).toHaveLength(1);
    const second = await evaluateAlerts(app);
    expect(second.triggered).toHaveLength(0);
    app.scheduler.stopAll();
  });

  it("schedules alert autopoll only when configured", () => {
    const off = buildIndodaxServer(loadEnv({}));
    expect(off.app.scheduler.running).not.toContain("alert-autopoll");
    off.app.scheduler.stopAll();
    const on = buildIndodaxServer(loadEnv({ ALERT_AUTOPOLL_MS: "30000" }));
    expect(on.app.scheduler.running).toContain("alert-autopoll");
    on.app.scheduler.stopAll();
  });

  it("autopoll triggers alerts without breaking on a quiet transport", async () => {
    const built = buildIndodaxServer(loadEnv({ ALERT_AUTOPOLL_MS: "50" }));
    built.app.publicClient = stubTicker("200");
    clearCache();
    built.app.alerts.add({ pair: "btc_idr", condition: { type: "above", price: "100" } });
    await new Promise((resolve) => setTimeout(resolve, 400));
    try {
      expect(built.app.alerts.list()).toHaveLength(0);
      expect(built.app.scheduler.failures).toHaveLength(0);
    } finally {
      built.app.scheduler.stopAll();
    }
  });

  it("serves active alerts as an MCP resource", async () => {
    const { server } = buildIndodaxServer(loadEnv({}));
    const harness = await withInMemoryServer(server);
    try {
      const resources = await harness.client.listResources();
      expect(resources.resources.map((resource) => resource.uri)).toContain("alerts://active");
    } finally {
      await harness.close();
    }
  });

  it("pushes notifications/message to listening clients", async () => {
    const { server } = buildIndodaxServer(loadEnv({}));
    const harness = await withInMemoryServer(server);
    try {
      const seen: unknown[] = [];
      harness.client.setNotificationHandler("notifications/message", (note) => {
        seen.push(note);
      });
      await server.sendLoggingMessage({ level: "notice", data: { alert: "a1" } });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(seen.length).toBeGreaterThan(0);
    } finally {
      await harness.close();
    }
  });

  it("denies exchange heartbeat without the live gate", async () => {
    const { server } = buildIndodaxServer(loadEnv({}));
    const harness = await withInMemoryServer(server);
    try {
      const denied = await harness.client.callTool({
        name: "indodax_deadman_heartbeat",
        arguments: { countdownMs: 60000, acknowledged: true },
      });
      expect(denied.isError).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("matches alerts across pair spellings", async () => {
    const { server, app } = buildIndodaxServer(loadEnv({}));
    const harness = await withInMemoryServer(server);
    try {
      const created = await harness.client.callTool({
        name: "indodax_alert_create",
        arguments: { pair: "BTCIDR", above: 100 },
      });
      expect(created.isError).not.toBe(true);
      const listed = (await dataOf(
        harness.client.callTool({ name: "indodax_alerts", arguments: {} }),
      )) as { alerts: { pair: string }[]; count: number };
      expect(listed.alerts[0]?.pair).toBe("btc_idr");
      expect(listed.count).toBe(1);
      app.publicClient = stubTicker("200");
      clearCache();
      const checked = (await dataOf(
        harness.client.callTool({ name: "indodax_alert_check", arguments: { pair: "btc_idr" } }),
      )) as { triggered: unknown[] };
      expect(checked.triggered).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it("exposes triggered alerts through the tool surface", async () => {
    const { server, app } = buildIndodaxServer(loadEnv({}));
    app.publicClient = stubTicker("200");
    clearCache();
    const harness = await withInMemoryServer(server);
    try {
      await harness.client.callTool({
        name: "indodax_alert_create",
        arguments: { pair: "btc_idr", above: 100 },
      });
      const checked = (await dataOf(
        harness.client.callTool({ name: "indodax_alert_check", arguments: { pair: "btc_idr" } }),
      )) as { triggered: unknown[] };
      expect(checked.triggered).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });
});
