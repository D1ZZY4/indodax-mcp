import { spawn, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withHttpUrl } from "@indodax-mcp/mcp-testing";

/**
 * Streamable HTTP transport end to end, against the real gateway process.
 *
 * The in-memory suite proves handler wiring and the stdio suite proves process
 * launch and stdout framing. This covers the remaining transport: the Hono
 * gateway, MCP session negotiation, and a real client completing initialize,
 * tools/list, resources/list, prompts/list and a tool call over a socket. It
 * launches the same entrypoint the container image runs, so the wiring is
 * exercised rather than assumed.
 *
 * The gateway needs the Bun runtime, which Vitest does not provide, so the
 * server is spawned rather than mounted in-process. Every call below is
 * read-only: nothing here can place, cancel, or transfer anything.
 */

const PORT = 18801;
const dir = join(dirname(fileURLToPath(import.meta.url)), "..");
const origin = `http://127.0.0.1:${PORT}`;

let child: ChildProcess | null = null;

async function waitForHealth(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return;
      lastError = new Error(`health returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`gateway never became healthy within ${timeoutMs}ms: ${String(lastError)}`);
}

beforeAll(async () => {
  child = spawn("bun", ["src/main.ts"], {
    cwd: dir,
    // DATABASE_URL is cleared so the gateway does not attach its persistence
    // mirrors to the developer's configured database. These specs exercise
    // transport and identity, which need no database.
    env: { ...process.env, MCP_PORT: String(PORT), DATABASE_URL: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  try {
    await waitForHealth(20_000);
  } catch (error) {
    throw new Error(`${String(error)}\ngateway stderr: ${stderr.slice(0, 800)}`);
  }
}, 40_000);

afterAll(() => {
  child?.kill("SIGTERM");
});

async function textOf(result: {
  content: { type: string; text: string }[];
  isError?: boolean;
}): Promise<{ status?: string; data?: Record<string, unknown> }> {
  return JSON.parse(
    result.content.map((block) => (block.type === "text" ? block.text : "")).join(""),
  ) as { status?: string; data?: Record<string, unknown> };
}

describe("streamable http transport against the running gateway", () => {
  it("serves health over plain HTTP", async () => {
    const response = await fetch(`${origin}/health`);
    expect(response.ok).toBe(true);
    const body = (await response.json()) as { status?: string };
    expect(body.status).toBe("ok");
  });

  it("negotiates a session and lists the full surface", async () => {
    const h = await withHttpUrl(`${origin}/mcp`);
    try {
      const tools = await h.client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain("indodax_health");
      expect(tools.tools.length).toBeGreaterThan(40);

      const resources = await h.client.listResources();
      expect(resources.resources.map((resource) => resource.uri)).toContain("system://health");

      const prompts = await h.client.listPrompts();
      expect(prompts.prompts.map((prompt) => prompt.name)).toContain("indodax_market_review");
    } finally {
      await h.close();
    }
  }, 30_000);

  it("carries tool annotations across the wire", async () => {
    const h = await withHttpUrl(`${origin}/mcp`);
    try {
      const { tools } = await h.client.listTools();
      expect(tools.filter((tool) => tool.annotations !== undefined).length).toBe(tools.length);
      const health = tools.find((tool) => tool.name === "indodax_health");
      expect(health?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
      const create = tools.find((tool) => tool.name === "indodax_create_order");
      expect(create?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      });
    } finally {
      await h.close();
    }
  }, 30_000);

  it("calls a read-only tool and returns the response envelope", async () => {
    const h = await withHttpUrl(`${origin}/mcp`);
    try {
      const result = (await h.client.callTool({
        name: "indodax_version",
        arguments: {},
      })) as { content: { type: string; text: string }[]; isError?: boolean };
      expect(result.isError).not.toBe(true);
      const body = await textOf(result);
      expect(body.status).toBe("ok");
      expect(body.data?.server).toBe("indodax-mcp");
      expect(body.data?.protocol).toBe("2025-11-25");
    } finally {
      await h.close();
    }
  }, 30_000);

  it("keeps sequential requests on one session", async () => {
    // A single client session issuing several calls must not trip the SDK guard
    // that rejects reusing one MCP server instance across requests.
    const h = await withHttpUrl(`${origin}/mcp`);
    try {
      for (let index = 0; index < 3; index += 1) {
        const tools = await h.client.listTools();
        expect(tools.tools.length).toBeGreaterThan(40);
      }
    } finally {
      await h.close();
    }
  }, 30_000);

  it("keeps withdrawal denied over the transport", async () => {
    const h = await withHttpUrl(`${origin}/mcp`);
    try {
      const result = (await h.client.callTool({
        name: "indodax_funding_withdraw",
        arguments: { currency: "btc", amount: 1, address: "nowhere" },
      })) as { content: { type: string; text: string }[]; isError?: boolean };
      expect(result.isError).toBe(true);
      const body = JSON.parse(result.content[0]?.text ?? "{}") as {
        code: string;
        message: string;
      };
      expect(body.code).toBe("AuthorizationError");
      expect(body.message).toContain("disabled");
    } finally {
      await h.close();
    }
  }, 30_000);
});
