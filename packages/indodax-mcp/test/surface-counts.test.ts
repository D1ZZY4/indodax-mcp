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
});
