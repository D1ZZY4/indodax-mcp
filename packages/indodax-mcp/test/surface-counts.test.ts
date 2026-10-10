/**
 * Pins the documented tool surface so prose and registry cannot drift again.
 *
 * The count appeared as 88 in the changelog, 89 in the README and the surface
 * page, and the registry reported a different number again. This asserts the
 * documented figures against the live registry so a future addition fails a
 * test rather than a reader's trust.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "@indodax-mcp/config";
import { buildIndodaxServer } from "@indodax-mcp/mcp-app";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function built() {
  const app = buildIndodaxServer(loadEnv({}));
  app.app.scheduler.stopAll();
  return app;
}

describe("documented surface figures", () => {
  it("matches the registry in every current-state document", () => {
    const { registry } = built();
    const tools = registry.listTools().length;
    const documents: [string, RegExp][] = [
      ["README.md", /The current server exposes (\d+) tools, (\d+) resources, and (\d+) prompts\./],
      [
        "CHANGELOG.md",
        /\*\*(\d+) MCP tools\*\*, \*\*(\d+) resources\*\*, and \*\*(\d+) prompts\*\*\./,
      ],
      [
        "docs/mcp/surface.md",
        /The registry currently contains \*\*(\d+) tools\*\*, \*\*(\d+) resources\*\*, and \*\*(\d+) prompts\*\*\./,
      ],
    ];
    const mismatched: string[] = [];
    for (const [file, pattern] of documents) {
      const match = pattern.exec(readFileSync(join(ROOT, file), "utf8"));
      if (!match) {
        mismatched.push(`${file}: no surface sentence matched`);
        continue;
      }
      const [toolsClaim, resourcesClaim, promptsClaim] = match
        .slice(1)
        .map((value) => Number(value));
      if (toolsClaim !== tools) mismatched.push(`${file}: tools ${toolsClaim} != ${tools}`);
      if (resourcesClaim !== registry.listResources().length) {
        mismatched.push(
          `${file}: resources ${resourcesClaim} != ${registry.listResources().length}`,
        );
      }
      if (promptsClaim !== registry.listPrompts().length) {
        mismatched.push(`${file}: prompts ${promptsClaim} != ${registry.listPrompts().length}`);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it("keeps the completeness matrix tool cell aligned", () => {
    const { registry } = built();
    const matrix = readFileSync(join(ROOT, "docs", "architecture", "completeness.md"), "utf8");
    const cell = /^\| MCP tools \| (\d+) \|/m.exec(matrix);
    expect(cell, "completeness matrix must carry a tool count cell").not.toBeNull();
    expect(Number(cell?.[1])).toBe(registry.listTools().length);
  });

  /**
   * Package READMEs ship to npm and are read by whoever installs the package,
   * so a count stated there is a published claim. The HTTP gateway README
   * carried "91 tools" after the 2.0.0 consolidation, and nothing asserted it.
   *
   * The pattern matches an unqualified current claim only. A sentence that also
   * names another version describes a migration ("consolidated from 91 to 68"),
   * where the old number is the point, so those are left alone.
   */
  it("keeps current counts in package READMEs aligned", () => {
    const { registry } = built();
    const tools = registry.listTools().length;
    const resources = registry.listResources().length;
    const prompts = registry.listPrompts().length;
    // Prose is hard-wrapped, so the claim can straddle a line break.
    const claim = /the same (\d+)\s+tools,\s+(\d+) resources, and (\d+) prompts/;
    const readmes = ["apps/mcp-http/README.md", "apps/mcp-stdio/README.md"];
    const mismatched: string[] = [];
    let checked = 0;
    for (const file of readmes) {
      const match = claim.exec(readFileSync(join(ROOT, file), "utf8"));
      // Only a file that states a current count can drift from it. One that
      // never states a count asserts nothing.
      if (!match) continue;
      checked += 1;
      if (Number(match[1]) !== tools) mismatched.push(`${file}: tools ${match[1]} != ${tools}`);
      if (Number(match[2]) !== resources) {
        mismatched.push(`${file}: resources ${match[2]} != ${resources}`);
      }
      if (Number(match[3]) !== prompts)
        mismatched.push(`${file}: prompts ${match[3]} != ${prompts}`);
    }
    // Guards against the pattern silently matching nothing after an edit.
    expect(checked).toBeGreaterThan(0);
    expect(mismatched).toEqual([]);
  });
});
