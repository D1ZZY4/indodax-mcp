import { spawn } from "node:child_process";
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
 *
 * This suite lives with the app it launches rather than in the harness package
 * that provides the transport. It runs this package's own `dist/index.js`, and
 * Turbo cannot order a build of `apps/mcp-stdio` for a task in
 * `packages/mcp-testing` without a circular workspace dependency, since this
 * app already depends on that package.
 */
const entry = new URL("../dist/index.js", import.meta.url).pathname;

const INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "stdio-raw", version: "0" },
  },
});
const INITIALIZED = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" });

/**
 * Raw framed stdio, for a refusal the client harness cannot render.
 *
 * A schema violation is refused by the protocol layer before any handler runs,
 * and the SDK client surfaces the resulting text as a JSON parse failure
 * instead of the message. Reading the server reply directly is the only way to
 * assert what the caller is actually told.
 */
function rawStdioCall(name: string, args: Record<string, unknown>): Promise<string> {
  const call = JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name, arguments: args },
  });
  return new Promise((resolve, reject) => {
    const child = spawn("bun", [entry], { stdio: ["pipe", "pipe", "ignore"] });
    let buffer = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`no reply for ${name} within 20s`));
    }, 20_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      for (const line of buffer.split("\n")) {
        if (!line.includes('"id":2')) continue;
        try {
          const parsed = JSON.parse(line) as {
            result?: { content?: { text?: string }[] };
          };
          const text = parsed.result?.content?.map((block) => block.text).join(" ") ?? "";
          if (text) {
            clearTimeout(timer);
            child.kill();
            resolve(text);
            return;
          }
        } catch {
          // Partial line; wait for more bytes.
        }
      }
    });
    child.stdin.write(`${INITIALIZE}\n${INITIALIZED}\n${call}\n`);
  });
}

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
      // `stopPrice` joins `riskBudget` as the advisory stop-distance input the
      // risk-budget work added; it must reach the handler or the assessment
      // silently degrades to a notional multiple. `reason` arrived with 2.0.0,
      // when indodax_validate_order absorbed indodax_propose_order, so the
      // free-text audit reason still reaches the handler over the wire.
      const properties = Object.keys(
        (validate?.inputSchema as { properties?: Record<string, unknown> } | undefined)
          ?.properties ?? {},
      ).sort();
      expect(properties).toEqual([
        "mode",
        "pair",
        "price",
        "quantity",
        "reason",
        "riskBudget",
        "side",
        "stopPrice",
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

  it("names the supported candle timeframes when a caller sends an alias", async () => {
    // The exchange answers 1H, 4H and D with "invalid TimeFrame", which cost a
    // live round trip per probe in a production loop. The schema now refuses
    // them locally, so the refusal has to enumerate what is accepted instead
    // of reporting an opaque option error.
    const text = await rawStdioCall("indodax_candles", {
      symbol: "btc_idr",
      timeframe: "4H",
    });
    expect(text).toContain("timeframe");
    for (const supported of ["60", "240", "1D", "1W"]) {
      expect(text).toContain(supported);
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
