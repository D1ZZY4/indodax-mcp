/**
 * Guards the tool-guide coverage invariants that drift silently.
 *
 * Three classes of drift are checked here because each has already occurred: a
 * registered tool documented nowhere, a tool documented on a page but missing
 * from that page's index row, and a guide page the docs tool cannot serve.
 * The numeric surface figures are pinned separately by surface-counts.test.ts,
 * which asserts the exact sentences rather than any bold number.
 *
 * Nothing here needs the network or credentials.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "@indodax-mcp/config";
import { buildIndodaxServer } from "@indodax-mcp/mcp-app";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DOCS = join(ROOT, "docs", "tools");

/** One index row: | Area | [file.md](file.md) | tool, list | */
const INDEX_ROW = /^\| (\w+) \| \[(\w+\.md)\]\(\2\) \| ([^|]+) \|$/gm;

/** A tool table row: a leading cell that names a registered tool. */
const TOOL_ROW = /^\| `(indodax_[a-z_]+)`/gm;

function registry() {
  const built = buildIndodaxServer(loadEnv({}));
  built.app.scheduler.stopAll();
  return built;
}

function docFiles(): string[] {
  return readdirSync(DOCS)
    .filter((file) => file.endsWith(".md"))
    .map((file) => join(DOCS, file));
}

describe("tool guide coverage", () => {
  it("documents every registered tool somewhere under docs/tools", () => {
    const corpus = docFiles()
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    const undocumented = registry()
      .registry.listTools()
      .map((tool) => tool.metadata.name)
      .filter((name) => !corpus.includes(name));
    expect(undocumented).toEqual([]);
  });

  it("lists every tool from a page in that page's index row", () => {
    const index = readFileSync(join(DOCS, "README.md"), "utf8");
    const rows = [...index.matchAll(INDEX_ROW)];
    expect(rows.length).toBeGreaterThan(0);
    const missing: string[] = [];
    for (const row of rows) {
      const area = row[1] ?? "";
      const file = row[2] ?? "";
      const listed = (row[3] ?? "").split(",").map((entry) => entry.trim());
      const text = readFileSync(join(DOCS, file), "utf8");
      for (const match of text.matchAll(TOOL_ROW)) {
        const short = match[1]?.replace("indodax_", "") ?? "";
        if (!listed.includes(short)) missing.push(`${area} (${file}) omits ${short}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("names only registered tools in the guide pages", () => {
    // A prompt or resource name in a tool table is a documentation error, so
    // every tool-shaped name on a page has to resolve in the registry.
    const names = new Set(
      registry()
        .registry.listTools()
        .map((tool) => tool.metadata.name),
    );
    const phantom: string[] = [];
    for (const file of docFiles()) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/^\| `(indodax_[a-z_]+)`/gm)) {
        const name = match[1] ?? "";
        if (!names.has(name)) phantom.push(`${file}: ${name}`);
      }
    }
    expect(phantom).toEqual([]);
  });
});

describe("docs tool serves the pages it advertises", () => {
  it("resolves every page named in the guide index", async () => {
    // A packed install copies docs/tools to docs-tools, so a page named in the
    // guide must be servable through indodax_docs in this repository too.
    const { withInMemoryServer } = await import("@indodax-mcp/mcp-testing");
    const { server, app } = registry();
    app.scheduler.stopAll();
    const pages = [
      "market",
      "account",
      "orders",
      "paper",
      "portfolio",
      "risk",
      "strategy",
      "alerts",
      "reconcile",
      "audit",
      "system",
      "funding",
      "history",
      "ops",
      "deadman",
      "stops",
      "errors",
      "docs",
    ];
    const harness = await withInMemoryServer(server);
    try {
      const failures: string[] = [];
      for (const page of pages) {
        const result = (await harness.client.callTool({
          name: "indodax_docs",
          arguments: { page },
        })) as { content: { text: string }[]; isError?: boolean };
        if (result.isError === true) failures.push(page);
      }
      expect(failures).toEqual([]);
    } finally {
      await harness.close();
    }
  });
});
