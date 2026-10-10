/**
 * Guards every user-facing place that *acts on* a tool name.
 *
 * The 2.0.0 consolidation retired twenty-five tool names. Three references to
 * retired names survived the rename, and each was invisible to the suite
 * because nothing tied them to the registry:
 *
 * - the workbench paper page still called the retired indodax_paper_status, so
 *   the page rendered an error instead of the ledger;
 * - the incident-review prompt told the agent to call retired tools, so the
 *   agent was instructed to invoke names that do not exist;
 * - the exchange rejection guidance named a retired balances tool, so an
 *   operator following the "next:" remedy got an error instead of the balances.
 *
 * Each is a reference a caller is expected to follow, so each is resolved
 * against the live registry here. The distinction that matters is between
 * *using* a name and *documenting* a retirement: tool descriptions deliberately
 * say "replaces the former indodax_balances", and that prose is correct.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadEnv } from "@indodax-mcp/config";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/mcp-app";
import { ORDER_OUTCOME_REMEDIES } from "@indodax-mcp/indodax-auth/rejections";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const WORKBENCH_SRC = join(ROOT, "apps", "mcp-workbench", "src");

const TOOL_NAME = /indodax_[a-z_]+/g;

/**
 * Sentence openers that record a retirement rather than directing a call.
 *
 * These are correct prose: the 2.0.0 tools describe what they replaced so a
 * migrating reader can follow the trail. A reference outside such a sentence
 * is an instruction, and an instruction to a retired name is a defect.
 */
const HISTORICAL_PHRASES = [
  "Replaces the former",
  "Absorbs the former",
  "Replaces retired",
  "retired indodax_",
];

function registeredTools(): Set<string> {
  const built = buildIndodaxServer(loadEnv({}));
  built.app.scheduler.stopAll();
  return new Set(built.registry.listTools().map((tool) => tool.metadata.name));
}

function sourcesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourcesIn(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Only the first argument of callTool is a name the page will actually invoke. */
function workbenchInvocations(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of sourcesIn(WORKBENCH_SRC)) {
    const text = readFileSync(file, "utf8");
    const pattern = /callTool(?:<[^>]*>)?\(\s*"(indodax_[a-z_]+)"/g;
    for (const match of text.matchAll(pattern)) {
      const name = match[1];
      if (name === undefined) continue;
      found.set(name, [...(found.get(name) ?? []), file.replace(ROOT, "")]);
    }
  }
  return found;
}

describe("workbench calls only registered tools", () => {
  it("invokes names the registry exposes", () => {
    const tools = registeredTools();
    const invocations = workbenchInvocations();
    // A page that calls nothing would make this vacuous, so require the real set.
    expect(invocations.size).toBeGreaterThan(0);
    const unknown = [...invocations]
      .filter(([name]) => !tools.has(name))
      .map(([name, files]) => `${name} (${files.join(", ")})`);
    expect(unknown).toEqual([]);
  });
});

describe("prompt text names only registered tools", () => {
  it("resolves every name the prompts tell the agent to call", async () => {
    const built = buildIndodaxServer(loadEnv({}));
    built.app.scheduler.stopAll();
    const tools = registeredTools();
    const harness = await withInMemoryServer(built.server);
    try {
      const listed = await harness.client.listPrompts();
      const offenders: string[] = [];
      for (const prompt of listed.prompts) {
        // Every declared argument is required, so supply a placeholder that
        // still exercises the instruction text the agent would receive.
        const args: Record<string, string> = {};
        for (const arg of prompt.arguments ?? []) args[arg.name] = `x-${arg.name}`;
        const got = (await harness.client.getPrompt({
          name: prompt.name,
          arguments: args,
        })) as { messages?: { content?: { type: string; text?: string } }[] };
        for (const message of got.messages ?? []) {
          const text = message.content?.type === "text" ? (message.content.text ?? "") : "";
          for (const name of new Set(text.match(TOOL_NAME) ?? [])) {
            if (!tools.has(name)) offenders.push(`${prompt.name}: ${name}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    } finally {
      await harness.close();
    }
  });
});

describe("exchange rejection guidance names only registered tools", () => {
  it("sends the operator to a tool that exists", () => {
    const tools = registeredTools();
    const offenders: string[] = [];
    for (const [code, outcome] of Object.entries(ORDER_OUTCOME_REMEDIES)) {
      // Only the imperative remedy is actionable. The reason slug and the
      // exchange's own text are not tool references.
      for (const match of outcome.guidance.matchAll(TOOL_NAME)) {
        const name = match[0];
        if (!tools.has(name)) offenders.push(`${code}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("tool descriptions direct callers to live tools", () => {
  it("names only tools the registry exposes", () => {
    // A description is the only guidance an agent gets when choosing between
    // tools, so a stale cross-reference sends it to a name that no longer
    // exists. Historical phrasing ("replaces the former X", "absorbed X") is
    // excluded because it documents the retirement rather than directing a
    // call; what remains is treated as a live reference.
    const built = buildIndodaxServer(loadEnv({}));
    built.app.scheduler.stopAll();
    const tools = new Set(built.registry.listTools().map((tool) => tool.metadata.name));
    const offenders: string[] = [];
    for (const tool of built.registry.listTools()) {
      // Strip the sentences that record a retirement, then check the rest.
      const live = tool.metadata.description
        .split(/(?<=[.;])\s+/)
        .filter((sentence) => !HISTORICAL_PHRASES.some((p) => sentence.includes(p)))
        .join(" ");
      for (const name of new Set(live.match(TOOL_NAME) ?? [])) {
        if (!tools.has(name)) offenders.push(`${tool.metadata.name}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
