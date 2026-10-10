import { spawn, type ChildProcess } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 18799;
const dir = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("mcp-http", () => {
  let child: ChildProcess | null = null;

  afterAll(() => {
    child?.kill("SIGTERM");
  });

  it("serves health over HTTP", async () => {
    child = spawn("bun", ["src/main.ts"], {
      cwd: dir,
      // DATABASE_URL is cleared so the gateway does not attach its persistence
      // mirrors to whatever database the developer happens to have configured.
      // These specs exercise transport and identity, which need no database,
      // and inheriting it made startup depend on that server's latency.
      env: { ...process.env, MCP_PORT: String(PORT), DATABASE_URL: "" },
      stdio: "ignore",
    });
    let response: Response | null = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        response = await fetch(`http://127.0.0.1:${PORT}/health`);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    const body = (await response?.json()) as { status?: string };
    expect(body.status).toBe("ok");
  }, 30_000);

  it("serves MCP initialize over Streamable HTTP", async () => {
    const init = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "http-test", version: "0" },
        },
      }),
    });
    expect(init.status).toBe(200);
    const listed = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    expect(listed.status).toBe(200);
    expect(await listed.text()).toContain("indodax_health");
  }, 30_000);
});
