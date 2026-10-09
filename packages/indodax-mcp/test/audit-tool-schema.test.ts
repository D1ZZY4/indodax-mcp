import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { loadEnv } from "@indodax-mcp/config";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/indodax-mcp";

/** Tool modules that register MCP tools. */
const TOOL_MODULES = [
  "account",
  "alerts",
  "audit",
  "candles",
  "deadman",
  "docs",
  "funding",
  "history",
  "market",
  "market-scan",
  "oco",
  "oco-attach",
  "ops",
  "ops-sockets",
  "orders",
  "paper",
  "portfolio",
  "positions",
  "quote",
  "reconcile",
  "risk",
  "rounding",
  "stop",
  "stop-check",
  "stop-create",
  "strategy",
  "symbols",
  "system",
];

/**
 * Matches a parseArgs call that builds its own inline schema.
 *
 * This is the exact shape of the indodax_validate_order defect: the MCP SDK
 * strips arguments the registered schema does not declare, so a handler that
 * parses a separately constructed, wider shape silently loses those parameters
 * and the call still reports success. No module may use this pattern; every
 * handler must parse the definition it registered.
 */
const INLINE_PARSE_SCHEMA = /parseArgs\(\s*z\s*\n?\s*\.object/;

describe("handler input schemas never exceed the advertised schema", () => {
  it("no handler builds an inline schema instead of parsing its registration", () => {
    // Regression guard for the indodax_validate_order defect, expressed as an
    // invariant rather than a scan. Every module declares each tool once with
    // defineTool and the handler parses that same object, so the two cannot
    // drift: there is no second shape to diverge from.
    const offenders = TOOL_MODULES.filter((name) =>
      INLINE_PARSE_SCHEMA.test(
        readFileSync(new URL(`../src/tools/${name}.ts`, import.meta.url), "utf8"),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps a definition for every tool that parses arguments", () => {
    // A module that parses arguments without defineTool has no shared object to
    // parse, which is the precondition for the drift above. Modules whose tools
    // take no arguments are exempt because they never call parseArgs.
    const offenders = TOOL_MODULES.filter((name) => {
      const source = readFileSync(new URL(`../src/tools/${name}.ts`, import.meta.url), "utf8");
      return source.includes("parseArgs(") && !source.includes("defineTool(");
    });
    expect(offenders).toEqual([]);
  });

  it("covers every module that registers tools", () => {
    // The two invariants above are only as strong as this list. If a new tool
    // module is added and not listed here, it escapes both checks silently.
    const onDisk = readdirSync(new URL("../src/tools/", import.meta.url))
      .filter((file) => file.endsWith(".ts"))
      // Helper modules: they do not call registerTool themselves.
      .filter(
        (file) =>
          ![
            "define.ts",
            "order-intent.ts",
            "ops-backtest.ts",
            "ops-exposure.ts",
            "paper-order.ts",
            "reconcile-exchange.ts",
            "stop-shared.ts",
          ].includes(file),
      )
      .map((file) => file.replace(/\.ts$/, ""));
    expect(onDisk.sort()).toEqual([...TOOL_MODULES].sort());
  });

  it("gives every registered tool a handler", async () => {
    // buildServer throws on a missing handler, so a successful build plus a
    // non-empty registry proves the two stay in step.
    const { registry, app } = buildIndodaxServer(loadEnv({}));
    app.scheduler.stopAll();
    expect(registry.listTools().length).toBeGreaterThan(0);
    const { server } = buildIndodaxServer(loadEnv({}));
    const harness = await withInMemoryServer(server);
    try {
      const listed = await harness.client.listTools();
      expect(listed.tools.length).toBe(registry.listTools().length);
    } finally {
      await harness.close();
    }
  });
});

describe("tool annotations reach the protocol", () => {
  it("marks reads, destructive mutations, and idempotent tools", async () => {
    const { server, app } = buildIndodaxServer(loadEnv({}));
    app.scheduler.stopAll();
    const harness = await withInMemoryServer(server);
    try {
      const listed = await harness.client.listTools();
      const byName = new Map(listed.tools.map((tool) => [tool.name, tool.annotations]));
      expect(listed.tools.filter((tool) => tool.annotations !== undefined).length).toBe(
        listed.tools.length,
      );
      expect(byName.get("indodax_ticker")).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      });
      expect(byName.get("indodax_create_order")).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      });
      expect(byName.get("indodax_paper_status")).toMatchObject({
        readOnlyHint: true,
        openWorldHint: false,
      });
      expect(byName.get("indodax_health")).toMatchObject({ openWorldHint: false });
    } finally {
      await harness.close();
    }
  });
});
