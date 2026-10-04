import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { z } from "zod";
import { ValidationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { fail, ok, parseArgs } from "../respond.js";
import type { AppServices } from "../composition.js";

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
  "docs",
] as const;

type DocsPage = (typeof PAGES)[number];

/** Locate docs/tools from any working directory by walking upward. */
function docsDir(from = process.cwd()): string | null {
  let dir = from;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, "docs", "tools");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function readPage(page: DocsPage): string | null {
  const dir = docsDir();
  if (!dir) return null;
  // Allowlist-only resolution: user input never becomes a path segment.
  const file = resolve(dir, `${page}.md`);
  if (!file.startsWith(`${dir}${sep}`) || !existsSync(file)) return null;
  return readFileSync(file, "utf8");
}

export function registerDocsTools(
  registry: Registry,
  handlers: ServerHandlers,
  _app: AppServices,
): void {
  void _app;
  registry.registerTool({
    metadata: {
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
    inputSchema: z.object({ page: z.string().min(1).optional() }),
  });

  handlers.tools.set("indodax_docs", async (raw) => {
    try {
      const args = parseArgs(z.object({ page: z.string().min(1).optional() }), raw);
      if (args.page === undefined) {
        const index = readPage("docs");
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
