import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..");

async function runCli(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", ["src/main.ts", ...args], { cwd: dir, env: process.env });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, out }));
  });
}

describe("cli", () => {
  it("shows help", async () => {
    const { code, out } = await runCli(["--help"]);
    expect(code).toBe(0);
    expect(out).toContain("indodax");
  });

  it("reports paper status offline", async () => {
    const { code, out } = await runCli(["paper", "status"]);
    expect(code).toBe(0);
    expect(out).toContain("trades=");
  });

  it("refuses paper reset without acknowledgement", async () => {
    const { code } = await runCli(["paper", "reset"]);
    expect(code).not.toBe(0);
  });

  it("resets paper state with acknowledgement", async () => {
    const { code, out } = await runCli(["paper", "reset", "--acknowledged"]);
    expect(code).toBe(0);
    expect(out).toContain("paper state reset");
  });

  // Runs only when DATABASE_URL is configured (CI service). Catches the
  // process hanging on an open database pool instead of exiting.
  it.runIf(process.env.DATABASE_URL)(
    "exits cleanly with DATABASE_URL configured",
    async () => {
      const { code, out } = await runCli(["paper", "status"]);
      expect(code).toBe(0);
      expect(out).toContain("trades=");
    },
    30_000,
  );
});
