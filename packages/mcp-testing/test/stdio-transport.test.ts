import { describe, expect, it } from "vitest";
import { withStdioCommand } from "@indodax-mcp/mcp-testing";

/**
 * End-to-end coverage over a real stdio transport.
 *
 * Every other suite connects in memory, which cannot catch a failure in process
 * launch, stdout framing, or the packaged entrypoint. This spawns the actual
 * binary an MCP client would launch, so the wiring is exercised rather than
 * assumed. It only lists tools and calls read-only tools: nothing here can
 * place, cancel, or transfer anything.
 */
const entry = new URL("../../../apps/mcp-stdio/dist/index.js", import.meta.url).pathname;

/**
 * The packaged stdio bundle is built by Bun, so it needs the Bun runtime.
 * process.execPath under Vitest is Node, which cannot execute it.
 */
async function harness() {
  return withStdioCommand("bun", [entry]);
}

describe("stdio transport", () => {
  it("completes initialize and lists the full surface", async () => {
    const h = await harness();
    try {
      const tools = await h.client.listTools();
      expect(tools.tools.length).toBeGreaterThan(0);
      expect(tools.tools.map((tool) => tool.name)).toContain("indodax_health");

      const resources = await h.client.listResources();
      expect(resources.resources.length).toBeGreaterThan(0);

      const prompts = await h.client.listPrompts();
      expect(prompts.prompts.length).toBeGreaterThan(0);
    } finally {
      await h.close();
    }
  }, 60_000);

  it("carries annotations and declared parameters over the wire", async () => {
    const h = await harness();
    try {
      const { tools } = await h.client.listTools();
      // Annotations are derived from tool metadata; a client uses them to gate
      // a call before invoking it, so they must survive serialization.
      expect(tools.filter((tool) => tool.annotations !== undefined).length).toBe(tools.length);

      const validate = tools.find((tool) => tool.name === "indodax_validate_order");
      // Over the wire the schema is plain JSON Schema, so the declared
      // properties are asserted here rather than the in-process Zod shape.
      const properties = Object.keys(
        (validate?.inputSchema as { properties?: Record<string, unknown> } | undefined)
          ?.properties ?? {},
      ).sort();
      expect(properties).toEqual([
        "mode",
        "pair",
        "price",
        "quantity",
        "side",
        "stpMode",
        "timeInForce",
      ]);
    } finally {
      await h.close();
    }
  }, 60_000);

  it("applies declared parameters rather than dropping them", async () => {
    const h = await harness();
    try {
      const result = (await h.client.callTool({
        name: "indodax_validate_order",
        arguments: {
          pair: "btc_idr",
          side: "BUY",
          quantity: 100,
          price: 1000,
          timeInForce: "GTC",
          stpMode: "EXPIRE_BOTH",
        },
      })) as { content: { type: string; text: string }[]; isError?: boolean };
      expect(result.isError).not.toBe(true);
      const body = JSON.parse(result.content[0]?.text ?? "{}") as {
        data: { order: { timeInForce?: string; stpMode?: string } };
      };
      // The SDK strips arguments the registered schema omits, so reaching the
      // handler at all is the regression this asserts.
      expect(body.data.order.timeInForce).toBe("GTC");
      expect(body.data.order.stpMode).toBe("EXPIRE_BOTH");
    } finally {
      await h.close();
    }
  }, 60_000);

  it("rejects an invalid shape with a typed error instead of a silent drop", async () => {
    const h = await harness();
    try {
      const result = (await h.client.callTool({
        name: "indodax_validate_order",
        arguments: { pair: "btc_idr", side: "BUY", quantity: 100, price: 1000, timeInForce: "FOK" },
      })) as { content: { type: string; text: string }[]; isError?: boolean };
      expect(result.isError).toBe(true);
      const failure = JSON.parse(result.content[0]?.text ?? "{}") as { message: string };
      expect(failure.message).toContain("FOK");
    } finally {
      await h.close();
    }
  }, 60_000);

  it("keeps withdrawal denied and reports credentials honestly", async () => {
    const h = await harness();
    try {
      const withdraw = (await h.client.callTool({
        name: "indodax_funding_withdraw",
        arguments: { currency: "btc", amount: 1, address: "somewhere" },
      })) as { isError?: boolean; content: { text: string }[] };
      expect(withdraw.isError).toBe(true);

      const status = (await h.client.callTool({ name: "indodax_config_status" })) as {
        content: { text: string }[];
      };
      const data = (
        JSON.parse(status.content[0]?.text ?? "{}") as {
          data: { withdrawEnabled: boolean; configSource: { credentials: Record<string, string> } };
        }
      ).data;
      expect(data.withdrawEnabled).toBe(false);
      // Origin names only, never values.
      for (const source of Object.values(data.configSource.credentials)) {
        expect(["process-env", "repo-env-file", "absent"]).toContain(source);
      }
    } finally {
      await h.close();
    }
  }, 60_000);
});
