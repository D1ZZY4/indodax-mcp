import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/server";
import { loadEnv } from "@indodax-mcp/config";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/mcp-app";

function build(): McpServer {
  return buildIndodaxServer(loadEnv({})).server;
}

describe("mcp-stdio production server", () => {
  it("initializes and lists the full tool surface", async () => {
    const harness = await withInMemoryServer(build());
    try {
      const tools = await harness.client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      expect(names).toContain("indodax_health");
      expect(names).toContain("indodax_ticker");
      expect(names).toContain("indodax_paper_order");
      expect(names.length).toBeGreaterThanOrEqual(40);
      const resources = await harness.client.listResources();
      expect(resources.resources.map((resource) => resource.uri)).toContain("system://health");
      const prompts = await harness.client.listPrompts();
      expect(prompts.prompts.map((prompt) => prompt.name)).toContain("indodax_market_review");
    } finally {
      await harness.close();
    }
  });

  it("invokes system health with structured success", async () => {
    const harness = await withInMemoryServer(build());
    try {
      const result = await harness.client.callTool({ name: "indodax_health", arguments: {} });
      expect(result.isError).not.toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("explains unwired health checks instead of bare unknown", async () => {
    const harness = await withInMemoryServer(build());
    try {
      const result = await harness.client.callTool({ name: "indodax_health", arguments: {} });
      expect(result.isError).not.toBe(true);
      const text = result.content.map((block) => (block.type === "text" ? block.text : "")).join();
      const body = JSON.parse(text) as {
        data: { components: Record<string, { status: string; detail?: string }> };
      };
      expect(body.data.components.database?.detail).toContain("not wired");
    } finally {
      await harness.close();
    }
  });

  it("runs paper lifecycle offline", async () => {
    const harness = await withInMemoryServer(build());
    try {
      const placed = await harness.client.callTool({
        name: "indodax_paper_order",
        arguments: { pair: "btc_idr", side: "BUY", price: 1000, quantity: 100 },
      });
      expect(placed.isError).not.toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("rejects unknown tools", async () => {
    const harness = await withInMemoryServer(build());
    try {
      await expect(
        harness.client.callTool({ name: "nope_missing", arguments: {} }),
      ).rejects.toThrow();
    } finally {
      await harness.close();
    }
  });

  it("serves Streamable HTTP end to end", async () => {
    const { buildHttpApp } = await import("@indodax-mcp/mcp-runtime");
    const { createServer } = buildIndodaxServer(loadEnv({}));
    const app = buildHttpApp(() => createServer());
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      host: "127.0.0.1",
      origin: "http://127.0.0.1",
    };
    const response = await app.request("/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "t", version: "0" },
        },
      }),
    });
    expect(response.status).toBe(200);
    const listed = await app.request("/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    expect(listed.status).toBe(200);
    const listedText = await listed.text();
    expect(listedText).toContain("indodax_health");
  });
});
