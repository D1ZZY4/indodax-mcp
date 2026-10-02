import { describe, expect, it } from "vitest";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildAppServer } from "../src/app.js";

describe("mcp-stdio vertical slice", () => {
  it("initializes and lists one tool, resource, and prompt", async () => {
    const harness = await withInMemoryServer(buildAppServer());
    try {
      const tools = await harness.client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain("system_health");
      const resources = await harness.client.listResources();
      expect(resources.resources.map((resource) => resource.uri)).toContain("system://health");
      const prompts = await harness.client.listPrompts();
      expect(prompts.prompts.map((prompt) => prompt.name)).toContain("review_status");
    } finally {
      await harness.close();
    }
  });

  it("invokes system_health with structured success", async () => {
    const harness = await withInMemoryServer(buildAppServer());
    try {
      const result = await harness.client.callTool({ name: "system_health", arguments: {} });
      expect(result.isError).not.toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("rejects unknown tools", async () => {
    const harness = await withInMemoryServer(buildAppServer());
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
    const app = buildHttpApp(buildAppServer);
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
    expect(listedText).toContain("system_health");
  });
});
