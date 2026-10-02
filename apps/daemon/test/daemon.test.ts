import { spawn, type ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("daemon", () => {
  it("boots and shuts down gracefully", async () => {
    const child: ChildProcess = spawn("bun", ["src/main.ts"], {
      cwd: dir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    child.kill("SIGTERM");
    const code = await new Promise<number>((resolve) => {
      child.on("close", (value) => resolve(value ?? -1));
    });
    expect(output).toContain("daemon ready");
    expect(output).toContain("shutdown complete");
    expect(code).toBe(0);
  }, 30_000);
});
