import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ValidationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { fail, ok, parseArgs } from "@indodax-mcp/mcp-app/respond";
import { defineTool } from "@indodax-mcp/mcp-app/tools/define";
import type { AppServices } from "@indodax-mcp/mcp-app/composition";

const PAGES = [
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
] as const;

type DocsPage = (typeof PAGES)[number];

/** Locate a guide directory by walking upward. Exported for tests. */
export function findDocsToolsDir(from: string): string | null {
  let dir = from;
  for (let depth = 0; depth < 8; depth += 1) {
    for (const candidate of [join(dir, "docs", "tools"), join(dir, "docs-tools")]) {
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function moduleDir(): string | null {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return null;
  }
}

function readPage(page: DocsPage): string | null {
  // Module-relative first so packed installs (docs-tools beside the bundle)
  // resolve without depending on the caller's working directory.
  const bases = [moduleDir(), process.cwd()].filter((base): base is string => base !== null);
  for (const base of bases) {
    const dir = findDocsToolsDir(base);
    if (!dir) continue;
    // Allowlist-only resolution: user input never becomes a path segment.
    const file = resolve(dir, `${page}.md`);
    if (!file.startsWith(`${dir}${sep}`) || !existsSync(file)) continue;
    return readFileSync(file, "utf8");
  }
  return null;
}

const docsTool = defineTool(
  {
    name: "indodax_docs",
    title: "Tool guides",
    description:
      "Read-only. Agent-harness guide pages with full parameters, responses, errors, and worked usage for every tool area. Omit page for the index, or pass one area name like market, orders, paper, risk, or deadman.",
    capability: "READ",
    riskClass: "read",
    environmentRequirement: "any",
    authRequirement: "none",
    destructive: false,
    idempotencyClass: "none",
    auditClass: "read",
  },
  { page: z.string().min(1).optional() },
);

export function registerDocsTools(
  registry: Registry,
  handlers: ServerHandlers,
  _app: AppServices,
): void {
  void _app;
  registry.registerTool(docsTool);

  handlers.tools.set("indodax_docs", async (raw) => {
    try {
      const args = parseArgs(docsTool.inputSchema, raw);
      if (args.page === undefined) {
        const index = readPage("docs");
        if (index === null) {
          return ok({ page: "index", pages: [...PAGES], markdown: null }, [
            "guide pages unavailable at runtime: packed docs-tools missing, not an empty guide",
          ]);
        }
        return ok({ page: "index", pages: [...PAGES], markdown: index });
      }
      const page = args.page.toLowerCase();
      if (!(PAGES as readonly string[]).includes(page)) {
        throw ValidationError(`unknown docs page ${args.page}; pages: ${PAGES.join(", ")}`);
      }
      const markdown = readPage(page as DocsPage);
      if (markdown === null) throw ValidationError(`docs page ${page} unavailable at runtime`);
      return ok({ page, markdown });
    } catch (error) {
      return fail(error);
    }
  });
}
