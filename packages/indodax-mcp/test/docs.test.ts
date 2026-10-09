import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findDocsToolsDir } from "@d1zzy4-jethools/mcp-app/tools/docs";

function scaffold(name: string): string {
  const root = mkdtempSync(join(tmpdir(), "docs-resolve-"));
  mkdirSync(join(root, "nested", "deep"), { recursive: true });
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, "market.md"), "# Market tools\n");
  return root;
}

describe("docs resolver", () => {
  it("finds repo-style docs/tools upward", () => {
    const root = scaffold(join("docs", "tools"));
    expect(findDocsToolsDir(join(root, "nested", "deep"))).toBe(join(root, "docs", "tools"));
  });

  it("finds packed docs-tools upward", () => {
    const root = scaffold("docs-tools");
    expect(findDocsToolsDir(join(root, "nested", "deep"))).toBe(join(root, "docs-tools"));
  });

  it("returns null when no guide directory exists above", () => {
    const root = mkdtempSync(join(tmpdir(), "docs-empty-"));
    mkdirSync(join(root, "a", "b"), { recursive: true });
    expect(findDocsToolsDir(join(root, "a", "b"))).toBeNull();
  });
});
