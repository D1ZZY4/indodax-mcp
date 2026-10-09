import { describe, expect, it } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/mcp-app";

function build() {
  return buildIndodaxServer(loadEnv({}));
}

async function bodyOf(call: Promise<unknown>): Promise<{ data: never }> {
  const result = (await call) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  expect(result.isError).not.toBe(true);
  return JSON.parse(result.content[0]?.text ?? "{}") as { data: never };
}

describe("indodax-mcp surface", () => {
  it("registers a broad tool surface with safety metadata", async () => {
    const { server, registry } = build();
    void server;
    const tools = registry.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(40);
    const names = new Set(tools.map((tool) => tool.metadata.name));
    expect(names.size).toBe(tools.length);
    for (const tool of tools) {
      expect(tool.metadata.description.length).toBeGreaterThan(20);
    }
    expect(registry.listResources().length).toBeGreaterThanOrEqual(7);
    expect(registry.listPrompts().length).toBeGreaterThanOrEqual(5);
  });

  it("builds a server, which fails fast when a registered tool has no handler", async () => {
    // buildServer throws on a missing handler, so a successful build proves
    // every registry entry is wired.
    const { server } = build();
    const harness = await withInMemoryServer(server);
    try {
      const listed = await harness.client.listTools();
      expect(listed.tools.length).toBeGreaterThanOrEqual(40);
    } finally {
      await harness.close();
    }
  });

  it("runs paper lifecycle offline", async () => {
    const { server } = build();
    const harness = await withInMemoryServer(server);
    try {
      const placed = await harness.client.callTool({
        name: "indodax_paper_order",
        arguments: { pair: "btc_idr", side: "BUY", price: 1000, quantity: 100 },
      });
      expect(placed.isError).not.toBe(true);
      const status = await harness.client.callTool({ name: "indodax_paper_status", arguments: {} });
      expect(status.isError).not.toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("denies withdrawal and validates inputs", async () => {
    const { server } = build();
    const harness = await withInMemoryServer(server);
    try {
      const denied = await harness.client.callTool({
        name: "indodax_funding_withdraw",
        arguments: { currency: "btc", amount: 0.1, address: "x" },
      });
      expect(denied.isError).toBe(true);
      const invalid = await harness.client.callTool({
        name: "indodax_risk_evaluate",
        arguments: {},
      });
      expect(invalid.isError).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("denies private tools centrally without credentials", async () => {
    const { server } = build();
    const harness = await withInMemoryServer(server);
    try {
      const denied = await harness.client.callTool({ name: "indodax_account", arguments: {} });
      expect(denied.isError).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("denies live placement even when acknowledged", async () => {
    const { server } = build();
    const harness = await withInMemoryServer(server);
    try {
      const denied = await harness.client.callTool({
        name: "indodax_create_order",
        arguments: {
          pair: "btc_idr",
          side: "BUY",
          quantity: 100,
          price: 1000,
          mode: "live",
          acknowledged: true,
        },
      });
      expect(denied.isError).toBe(true);
      const unacked = await harness.client.callTool({
        name: "indodax_cancel_order",
        arguments: { orderId: "o1", mode: "live" },
      });
      expect(unacked.isError).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("keeps memory audit trail without a database", async () => {
    const { app } = build();
    expect(app.env.DATABASE_URL).toBeUndefined();
    const harness = await withInMemoryServer(build().server);
    try {
      const events = await harness.client.callTool({ name: "indodax_audit_events", arguments: {} });
      expect(events.isError).not.toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("reports live placement denied while server policy is paper-only", async () => {
    const { server } = build();
    const harness = await withInMemoryServer(server);
    try {
      const body = await bodyOf(
        harness.client.callTool({ name: "indodax_capabilities", arguments: {} }),
      );
      const data = body.data as {
        "trade.place": boolean;
        "trade.cancel": boolean;
        "funding.withdraw": boolean;
      };
      expect(data["trade.place"]).toBe(false);
      expect(data["trade.cancel"]).toBe(false);
      expect(data["funding.withdraw"]).toBe(false);
    } finally {
      await harness.close();
    }
  });

  it("checks paper-local consistency instead of self-comparison", async () => {
    const { server } = build();
    const harness = await withInMemoryServer(server);
    try {
      const empty = await bodyOf(
        harness.client.callTool({ name: "indodax_reconciliation_state", arguments: {} }),
      );
      expect((empty.data as { state: string; checkedOrders: number }).state).toBe("MATCH");
      expect((empty.data as { checkedOrders: number }).checkedOrders).toBe(0);

      const placed = await harness.client.callTool({
        name: "indodax_paper_order",
        arguments: { pair: "btc_idr", side: "BUY", price: 1000, quantity: 100 },
      });
      expect(placed.isError).not.toBe(true);
      const filled = await bodyOf(
        harness.client.callTool({ name: "indodax_reconciliation_state", arguments: {} }),
      );
      expect((filled.data as { state: string }).state).toBe("MATCH");
      expect((filled.data as { checkedOrders: number }).checkedOrders).toBe(1);
    } finally {
      await harness.close();
    }
  });

  it("replays a repeated clientOrderId instead of placing twice", async () => {
    const { server, app } = build();
    const harness = await withInMemoryServer(server);
    try {
      const args = {
        pair: "btc_idr",
        side: "BUY",
        price: 1000,
        quantity: 100,
        clientOrderId: "replay-1",
      };
      const first = await harness.client.callTool({
        name: "indodax_paper_order",
        arguments: args,
      });
      expect(first.isError).not.toBe(true);
      const second = await harness.client.callTool({
        name: "indodax_paper_order",
        arguments: args,
      });
      expect(second.isError).not.toBe(true);
      expect(app.paper.snapshot().tradeCount).toBe(1);
    } finally {
      await harness.close();
    }
  });

  it("denies full reconciliation without credentials", async () => {
    const { server } = build();
    const harness = await withInMemoryServer(server);
    try {
      const denied = await harness.client.callTool({
        name: "indodax_reconcile_full",
        arguments: { symbol: "btcidr" },
      });
      expect(denied.isError).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("requires TRADE_ENABLED for live placement", async () => {
    const live = buildIndodaxServer(loadEnv({ APP_ENV: "live" }));
    const harness = await withInMemoryServer(live.server);
    try {
      const denied = await harness.client.callTool({
        name: "indodax_create_order",
        arguments: {
          pair: "btc_idr",
          side: "BUY",
          quantity: 0.01,
          price: 1000,
          mode: "live",
          acknowledged: true,
        },
      });
      expect(denied.isError).toBe(true);
      const text = (denied.content as { type: string; text: string }[])[0]?.text ?? "{}";
      expect(JSON.parse(text) as { message: string }).toMatchObject({
        message: expect.stringContaining("TRADE_ENABLED") as unknown as string,
      });
    } finally {
      await harness.close();
    }
  });

  it("reports healthy local components at boot", async () => {
    const { app } = buildIndodaxServer(loadEnv({}));
    const snapshot = app.health.snapshot();
    expect(snapshot.configuration.status).toBe("healthy");
    expect(snapshot.runtime.status).toBe("healthy");
    expect(snapshot.mcpTransport.status).toBe("healthy");
    expect(snapshot.deadman.status).toBe("healthy");
  });

  it("gates live execution on APP_ENV plus credentials", async () => {
    const live = buildIndodaxServer(loadEnv({ APP_ENV: "live" }));
    expect(live.app.policy.allowedModes).toContain("live");
    const harness = await withInMemoryServer(live.server);
    try {
      const denied = await harness.client.callTool({
        name: "indodax_create_order",
        arguments: {
          pair: "btc_idr",
          side: "BUY",
          quantity: 0.01,
          price: 1000,
          mode: "live",
          acknowledged: true,
        },
      });
      expect(denied.isError).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("cancels paper orders by client order id", async () => {
    const { server } = build();
    const harness = await withInMemoryServer(server);
    try {
      const placed = await harness.client.callTool({
        name: "indodax_paper_order",
        arguments: {
          pair: "btc_idr",
          side: "BUY",
          price: 1000,
          quantity: 100,
          clientOrderId: "cancel-by-cid",
        },
      });
      expect(placed.isError).not.toBe(true);
      const cancelled = await harness.client.callTool({
        name: "indodax_paper_cancel",
        arguments: { orderId: "cancel-by-cid" },
      });
      expect(cancelled.isError).not.toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("denies private channel connect without credentials", async () => {
    const { server } = build();
    const harness = await withInMemoryServer(server);
    try {
      const denied = await harness.client.callTool({
        name: "indodax_private_connect",
        arguments: {},
      });
      expect(denied.isError).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("serves guide pages and rejects traversal", async () => {
    const { server } = build();
    const harness = await withInMemoryServer(server);
    try {
      const index = await bodyOf(harness.client.callTool({ name: "indodax_docs", arguments: {} }));
      expect((index.data as { pages: string[] }).pages).toContain("market");
      expect((index.data as { pages: string[] }).pages).toContain("errors");
      const page = await harness.client.callTool({
        name: "indodax_docs",
        arguments: { page: "risk" },
      });
      expect(page.isError).not.toBe(true);
      const errors = await bodyOf(
        harness.client.callTool({ name: "indodax_docs", arguments: { page: "errors" } }),
      );
      expect((errors.data as { markdown: string }).markdown).toContain("FUNDING_UNAUTHORIZED");
      const evil = await harness.client.callTool({
        name: "indodax_docs",
        arguments: { page: "../../package" },
      });
      expect(evil.isError).toBe(true);
    } finally {
      await harness.close();
    }
  });
});
