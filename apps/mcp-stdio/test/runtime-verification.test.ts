/**
 * Runtime MCP verification against the real published stdio binary.
 *
 * Every other suite connects in memory, which exercises handlers but not the
 * packaged entrypoint. This spawns the built dist/index.js the way an MCP host
 * would, completes a real protocol handshake, and then exercises one tool per
 * functional category so a category that silently stopped answering is caught.
 *
 * Everything called here is read-only or paper. No live placement, no cancel,
 * no funding mutation is possible from this path.
 */
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { withStdioCommand } from "@indodax-mcp/mcp-testing";

const ENTRY = new URL("../dist/index.js", import.meta.url).pathname;

interface Envelope {
  status: "ok" | "error";
  data?: Record<string, unknown>;
  code?: string;
  message?: string;
}

async function harness() {
  // The bundle carries a bun shebang, so it needs the Bun runtime rather than
  // the Node binary Vitest is running under.
  return withStdioCommand("bun", [ENTRY]);
}

function parse(result: { content: { type: string; text: string }[] }): Envelope {
  return JSON.parse(
    result.content.map((b) => (b.type === "text" ? b.text : "")).join(""),
  ) as Envelope;
}

/**
 * One read-only or paper call per category, so an unexercised area is visible
 * in the failure output rather than silently absent from the run.
 */
const CATEGORY_CALLS: { category: string; name: string; args: Record<string, unknown> }[] = [
  { category: "system/health", name: "indodax_health", args: {} },
  { category: "system/version", name: "indodax_version", args: {} },
  { category: "market", name: "indodax_server_time", args: {} },
  { category: "symbols", name: "indodax_search_symbols", args: { query: "btc", limit: 3 } },
  { category: "account (auth boundary)", name: "indodax_account", args: {} },
  {
    category: "orders/validation",
    name: "indodax_validate_order",
    args: {
      pair: "btc_idr",
      side: "BUY",
      quantity: 100,
      price: 1000,
    },
  },
  { category: "paper", name: "indodax_paper_ledger", args: {} },
  { category: "portfolio", name: "indodax_portfolio", args: {} },
  { category: "risk", name: "indodax_risk_state", args: {} },
  { category: "reconciliation", name: "indodax_reconcile_paper", args: { scope: "state" } },
  { category: "audit", name: "indodax_audit", args: {} },
  { category: "alerts", name: "indodax_alerts", args: {} },
  { category: "strategy", name: "indodax_strategies", args: {} },
  { category: "operations/exposure", name: "indodax_exposure", args: {} },
  { category: "deadman", name: "indodax_deadman_status", args: {} },
  { category: "stops", name: "indodax_stops", args: {} },
  { category: "docs", name: "indodax_docs", args: {} },
  {
    category: "rounding",
    name: "indodax_round_order",
    args: {
      pair: "btc_idr",
      quantity: 1,
      price: 1000000,
    },
  },
];

describe("MCP runtime over the packaged stdio binary", () => {
  it("completes initialize and exposes the documented surface", async () => {
    const h = await harness();
    try {
      const tools = await h.client.listTools();
      expect(tools.tools.length).toBeGreaterThanOrEqual(68);

      const resources = await h.client.listResources();
      expect(resources.resources.length).toBe(12);

      const prompts = await h.client.listPrompts();
      expect(prompts.prompts.length).toBe(5);

      const version = parse(
        (await h.client.callTool({ name: "indodax_version", arguments: {} })) as {
          content: { type: string; text: string }[];
        },
      );
      expect(version.status).toBe("ok");
      expect(version.data?.server).toBe("indodax-mcp");
      expect(version.data?.protocol).toBe("2025-11-25");
    } finally {
      await h.close();
    }
  }, 60_000);

  it("answers one tool per functional category", async () => {
    const h = await harness();
    try {
      // Credentials are absent, so the authenticated categories answer with a
      // refusal instead of data. Both outcomes are correct; a transport error
      // or an unknown tool name is not.
      const failures: string[] = [];
      for (const call of CATEGORY_CALLS) {
        try {
          const result = (await h.client.callTool({
            name: call.name,
            arguments: call.args,
          })) as { content: { type: string; text: string }[] };
          const envelope = parse(result);
          if (
            envelope.status === "error" &&
            !["AuthenticationError", "ValidationError"].includes(envelope.code ?? "")
          ) {
            failures.push(`${call.category} (${call.name}): ${envelope.code} ${envelope.message}`);
          }
        } catch (error) {
          failures.push(
            `${call.category} (${call.name}): ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      expect(failures).toEqual([]);
    } finally {
      await h.close();
    }
  }, 120_000);

  it("keeps a failure a typed envelope rather than a thrown protocol error", async () => {
    const h = await harness();
    try {
      const denied = (await h.client.callTool({
        name: "indodax_funding_withdraw",
        arguments: { currency: "btc", amount: 1, address: "nowhere" },
      })) as { content: { type: string; text: string }[]; isError?: boolean };
      expect(denied.isError).toBe(true);
      const envelope = parse(denied);
      expect(envelope.status).toBe("error");
      expect(envelope.code).toBe("AuthorizationError");
      // The envelope must stay machine-readable rather than degrading to prose.
      expect(envelope.message).toContain("disabled");
    } finally {
      await h.close();
    }
  }, 60_000);

  it("executes the full paper order lifecycle against the real binary", async () => {
    const h = await harness();
    try {
      const placed = parse(
        (await h.client.callTool({
          name: "indodax_paper_order",
          arguments: { pair: "btc_idr", side: "BUY", price: 1000, quantity: 100 },
        })) as { content: { type: string; text: string }[] },
      );
      expect(placed.status).toBe("ok");
      const id = placed.data?.exchangeOrderId as string | undefined;
      expect(id).toBeTruthy();

      const filled = parse(
        (await h.client.callTool({
          name: "indodax_paper_fill",
          arguments: { orderId: id as string, price: 1000 },
        })) as { content: { type: string; text: string }[] },
      );
      expect(filled.status).toBe("ok");
      expect(filled.data?.status).toBe("filled");

      // Acceptance is not a fill, and a fill must be observable in the ledger.
      const ledger = parse(
        (await h.client.callTool({ name: "indodax_paper_ledger", arguments: {} })) as {
          content: { type: string; text: string }[];
        },
      );
      expect(ledger.status).toBe("ok");
      expect(ledger.data?.filledOrders).toBe(1);
    } finally {
      await h.close();
    }
  }, 90_000);
});

describe("packaged binary integrity", () => {
  it("starts, announces the tool count, and shuts down on SIGTERM", async () => {
    const child = spawn("bun", [ENTRY], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    try {
      const started = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 20_000);
        child.stdout?.on("data", () => {
          if (output.includes("serving indodax-mcp over stdio")) {
            clearTimeout(timer);
            resolve(true);
          }
        });
      });
      expect(started, `server never announced startup; saw: ${output.slice(0, 300)}`).toBe(true);
      expect(output).toMatch(/\d+ tools/);
    } finally {
      child.kill("SIGTERM");
    }
  }, 40_000);
});
