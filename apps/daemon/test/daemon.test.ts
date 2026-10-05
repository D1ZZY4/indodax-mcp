import { spawn, type ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Resolve once `needle` appears in the child's combined output.
 *
 * The daemon logs "daemon ready" only after reconcileOnce finishes its live
 * market reads, so a fixed sleep races those network calls and fails whenever
 * the suite runs under parallel load. Waiting on the line tests the real
 * contract instead of a guess about how long a ticker takes.
 */
function waitForOutput(
  child: ChildProcess,
  needle: string,
  output: () => string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`daemon never logged "${needle}" within ${timeoutMs}ms; saw: ${output()}`));
    }, timeoutMs);
    const check = (): void => {
      if (output().includes(needle)) {
        clearTimeout(timer);
        resolve(output());
      }
    };
    child.stdout?.on("data", check);
    child.stderr?.on("data", check);
    check();
  });
}

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

    const exited = new Promise<number>((resolve) => {
      child.on("close", (value) => resolve(value ?? -1));
    });

    await waitForOutput(child, "daemon ready", () => output, 25_000);
    child.kill("SIGTERM");

    await waitForOutput(child, "shutdown complete", () => output, 10_000);
    expect(await exited).toBe(0);
  }, 45_000);
});
