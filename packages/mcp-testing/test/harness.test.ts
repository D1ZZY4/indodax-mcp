import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";

describe("mcp-testing", () => {
  it("drives a server through the harness", async () => {
    const server = new McpServer({ name: "tiny", version: "1.0.0" });
    server.registerTool(
      "ping",
      { description: "Ping tool for harness tests.", inputSchema: z.object({}) },
      async () => ({ content: [{ type: "text" as const, text: "pong" }] }),
    );
    const harness = await withInMemoryServer(server);
    try {
      const result = await harness.client.callTool({ name: "ping", arguments: {} });
      expect(result.isError).not.toBe(true);
    } finally {
      await harness.close();
    }
  });
});
