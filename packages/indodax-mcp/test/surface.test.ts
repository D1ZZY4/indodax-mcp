import { describe, expect, it } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "../src/index.js";

function build() {
  return buildIndodaxServer(loadEnv({}));
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
      const result = await harness.client.callTool({ name: "indodax_capabilities", arguments: {} });
      expect(result.isError).not.toBe(true);
      const text = (result.content as { type: string; text: string }[])[0]?.text ?? "{}";
      const data = JSON.parse(text) as {
        data: { "trade.place": boolean; "trade.cancel": boolean; "funding.withdraw": boolean };
      };
      expect(data.data["trade.place"]).toBe(false);
      expect(data.data["trade.cancel"]).toBe(false);
      expect(data.data["funding.withdraw"]).toBe(false);
    } finally {
      await harness.close();
    }
  });

  it("checks paper-local consistency instead of self-comparison", async () => {
    const { server } = build();
    const harness = await withInMemoryServer(server);
    try {
      const empty = await harness.client.callTool({
        name: "indodax_reconciliation_state",
        arguments: {},
      });
      expect(empty.isError).not.toBe(true);
      const emptyText = (empty.content as { type: string; text: string }[])[0]?.text ?? "{}";
      const emptyData = JSON.parse(emptyText) as {
        data: { state: string; checkedOrders: number };
      };
      expect(emptyData.data.state).toBe("MATCH");
      expect(emptyData.data.checkedOrders).toBe(0);

      const placed = await harness.client.callTool({
        name: "indodax_paper_order",
        arguments: { pair: "btc_idr", side: "BUY", price: 1000, quantity: 100 },
      });
      expect(placed.isError).not.toBe(true);
      const filled = await harness.client.callTool({
        name: "indodax_reconciliation_state",
        arguments: {},
      });
      const filledText = (filled.content as { type: string; text: string }[])[0]?.text ?? "{}";
      const filledData = JSON.parse(filledText) as {
        data: { state: string; checkedOrders: number };
      };
      expect(filledData.data.state).toBe("MATCH");
      expect(filledData.data.checkedOrders).toBe(1);
    } finally {
      await harness.close();
    }
  });

  it("replays a repeated clientOrderId instead of placing twice", async () => {
    const { server, app } = build();
    const harness = await withInMemoryServer(server);
    try {
      const first = await harness.client.callTool({
        name: "indodax_paper_order",
        arguments: {
          pair: "btc_idr",
          side: "BUY",
          price: 1000,
          quantity: 100,
          clientOrderId: "replay-1",
        },
      });
      expect(first.isError).not.toBe(true);
      const second = await harness.client.callTool({
        name: "indodax_paper_order",
        arguments: {
          pair: "btc_idr",
          side: "BUY",
          price: 1000,
          quantity: 100,
          clientOrderId: "replay-1",
        },
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

  it("reconciles paper against stubbed exchange state", async () => {
    const built = build();
    built.app.accountClient = {
      getAccount: async () => ({
        canTrade: true,
        canWithdraw: false,
        balances: [{ asset: "IDR", free: "100000000", locked: "0" }],
      }),
      openOrders: async () => [{ orderId: 42, symbol: "BTCIDR" }],
      myTrades: async () => ({ data: [] }),
    } as unknown as NonNullable<typeof built.app.accountClient>;
    const harness = await withInMemoryServer(built.server);
    try {
      const result = await harness.client.callTool({
        name: "indodax_reconcile_full",
        arguments: { symbol: "btcidr" },
      });
      expect(result.isError).not.toBe(true);
      const text = (result.content as { type: string; text: string }[])[0]?.text ?? "{}";
      const data = JSON.parse(text) as {
        data: {
          paper: { state: string };
          exchange: { openOrders: unknown[]; balances: unknown[] };
        };
      };
      expect(data.data.paper.state).toBe("MATCH");
      expect(data.data.exchange.openOrders).toHaveLength(1);
      expect(data.data.exchange.balances).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });
});
