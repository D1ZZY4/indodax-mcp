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
      env: { ...process.env, MCP_PORT: String(PORT) },
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
});
