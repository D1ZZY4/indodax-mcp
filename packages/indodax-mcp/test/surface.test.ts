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
});
