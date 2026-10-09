/**
 * Guards the server version against the manifests it ships from.
 *
 * The version was previously a literal in three places: the MCP `version`
 * tool, the HTTP health body, and the package manifests. A release bump that
 * missed one produced a server that misreported which release it was, which is
 * exactly what an operator needs when a production loop reports a problem. The
 * constant now lives in one module and this test holds it to the manifests.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "@indodax-mcp/config";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer, SERVER_NAME, SERVER_VERSION } from "@indodax-mcp/mcp-app";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** The two packages that ship, and therefore the version that matters. */
const PUBLISHABLE = ["apps/mcp-stdio", "apps/cli"] as const;

function manifestVersion(dir: string): string {
  const manifest = JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8")) as {
    version: string;
  };
  return manifest.version;
}

describe("server version stays in step with the manifests", () => {
  it("matches every publishable package version", () => {
    const mismatched = PUBLISHABLE.filter((dir) => manifestVersion(dir) !== SERVER_VERSION);
    expect(
      mismatched,
      `SERVER_VERSION ${SERVER_VERSION} does not match: ${mismatched.join(", ")}`,
    ).toEqual([]);
  });

  it("uses a real semantic version rather than a placeholder", () => {
    expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("keeps the workspace packages on the same version line", () => {
    // Every workspace manifest is bumped together so a consumer resolving an
    // internal dependency never sees a package ahead of the release it ships in.
    const drifted: string[] = [];
    for (const area of ["apps", "packages"]) {
      for (const entry of ["cli", "daemon", "mcp-http", "mcp-stdio", "mcp-workbench"].concat([
        "config",
        "core",
        "db",
        "errors",
        "events",
        "indodax-account",
        "indodax-alerts",
        "indodax-audit",
        "indodax-auth",
        "indodax-backtest",
        "indodax-client",
        "indodax-deadman",
        "indodax-execution",
        "indodax-market",
        "indodax-mcp",
        "indodax-orders",
        "indodax-paper",
        "indodax-portfolio",
        "indodax-reconciliation",
        "indodax-risk",
        "indodax-strategy",
        "indodax-trading",
        "indodax-websocket",
        "logging",
        "mcp-contracts",
        "mcp-core",
        "mcp-registry",
        "mcp-runtime",
        "mcp-testing",
        "observability",
        "scheduler",
        "secrets",
        "storage",
        "transport",
      ])) {
        const dir = join(ROOT, area, entry);
        try {
          readFileSync(join(dir, "package.json"), "utf8");
        } catch {
          continue;
        }
        if (manifestVersion(`${area}/${entry}`) !== SERVER_VERSION)
          drifted.push(`${area}/${entry}`);
      }
    }
    expect(drifted, `workspaces not on ${SERVER_VERSION}: ${drifted.join(", ")}`).toEqual([]);
  });
});

describe("version is reported consistently at runtime", () => {
  it("reports the manifest version through indodax_version", async () => {
    const { server, app } = buildIndodaxServer(loadEnv({}));
    app.scheduler.stopAll();
    const harness = await withInMemoryServer(server);
    try {
      const result = (await harness.client.callTool({
        name: "indodax_version",
        arguments: {},
      })) as { content: { text: string }[]; isError?: boolean };
      expect(result.isError).not.toBe(true);
      const body = JSON.parse(result.content[0]?.text ?? "{}") as {
        data: { server: string; version: string; summary: string };
      };
      expect(body.data.server).toBe(SERVER_NAME);
      expect(body.data.version).toBe(SERVER_VERSION);
      expect(body.data.summary).toContain(SERVER_VERSION);
    } finally {
      await harness.close();
    }
  });

  it("uses the same version for the MCP handshake", async () => {
    const { server, app } = buildIndodaxServer(loadEnv({}));
    app.scheduler.stopAll();
    const harness = await withInMemoryServer(server);
    try {
      const info = harness.client.getServerVersion?.();
      // The client helper is optional across SDK versions, so assert through the
      // registry constant instead when it is unavailable.
      if (info !== undefined) expect(info.version).toBe(SERVER_VERSION);
      expect(SERVER_VERSION).toBe(manifestVersion("apps/mcp-stdio"));
    } finally {
      await harness.close();
    }
  });
});
