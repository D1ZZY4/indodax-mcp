import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { buildHttpApp, serveHttp } from "../src/index.js";

function tinyServer(): McpServer {
  const server = new McpServer({ name: "tiny", version: "1.0.0" });
  server.registerTool(
    "ping",
    { description: "Ping tool for runtime tests.", inputSchema: z.object({}) },
    async () => ({ content: [{ type: "text" as const, text: "pong" }] }),
  );
  return server;
}

describe("mcp-runtime", () => {
  it("serves initialize over the Hono app", async () => {
    const app = buildHttpApp(tinyServer);
    const response = await app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        host: "127.0.0.1",
        origin: "http://127.0.0.1",
      },
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
  });

  it("serves sequential requests from a fresh factory", async () => {
    const app = buildHttpApp(tinyServer);
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      host: "127.0.0.1",
      origin: "http://127.0.0.1",
    };
    const first = await app.request("/mcp", {
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
    expect(first.status).toBe(200);
    const second = await app.request("/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    expect(second.status).toBe(200);
    expect(await second.text()).toContain("ping");
  });

  it("refuses to serve without the Bun runtime", () => {
    expect(() => serveHttp(tinyServer, { port: 1 })).toThrow(/Bun runtime/);
  });
});
