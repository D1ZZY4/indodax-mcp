import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Import style is an enforced invariant, not a convention.
 *
 * Every module is imported through its package name so that layering stays
 * visible and the emitted `dist/` never depends on a hand-written file
 * extension. This test fails the build when a relative import reappears, and
 * when the resolution wiring that makes package-name imports work drifts out of
 * step with the workspace manifests.
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function workspaces(area: "packages" | "apps"): string[] {
  return readdirSync(join(ROOT, area), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(ROOT, area, entry.name))
    .filter((dir) => {
      try {
        readFileSync(join(dir, "package.json"), "utf8");
        return true;
      } catch {
        return false;
      }
    })
    .sort();
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Build output and dependencies are never authored source.
      if (entry.name === "dist" || entry.name === "node_modules") continue;
      out.push(...sourceFiles(full));
      continue;
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** A relative specifier: `./x`, `../x`. The CSS side-effect import is exempt. */
const RELATIVE = /(?:from|import)\s*"(\.[^"]*)"/g;

function relativeImports(file: string): string[] {
  const found: string[] = [];
  for (const match of readFileSync(file, "utf8").matchAll(RELATIVE)) {
    const spec = match[1] ?? "";
    if (spec.endsWith(".css")) continue;
    found.push(spec);
  }
  return found;
}

function repoSource(): string[] {
  const files: string[] = [];
  for (const area of ["packages", "apps"] as const) {
    for (const workspace of workspaces(area)) {
      for (const sub of ["src", "test"]) {
        const dir = join(workspace, sub);
        try {
          files.push(...sourceFiles(dir));
        } catch {
          // A workspace without a test directory is normal.
        }
      }
    }
  }
  return files.sort();
}

describe("import style", () => {
  it("uses package names everywhere and no relative imports", () => {
    const offenders: string[] = [];
    for (const file of repoSource()) {
      for (const spec of relativeImports(file)) {
        offenders.push(`${file.replace(ROOT, "")}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps a paths entry for every workspace package", () => {
    // TypeScript resolves package-name imports through `paths`. A missing entry
    // would only surface as a confusing resolution error in one dependent
    // package, so assert the wiring covers the whole workspace instead.
    const base = JSON.parse(readFileSync(join(ROOT, "tsconfig.base.json"), "utf8")) as {
      compilerOptions: { paths?: Record<string, string[]> };
    };
    const paths = base.compilerOptions.paths ?? {};
    const missing: string[] = [];
    for (const area of ["packages", "apps"] as const) {
      for (const workspace of workspaces(area)) {
        const name = (
          JSON.parse(readFileSync(join(workspace, "package.json"), "utf8")) as { name: string }
        ).name;
        for (const key of [name, `${name}/*`]) {
          if (paths[key] === undefined) missing.push(key);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("narrows each build config to its own package so rootDir holds", () => {
    // Declaration emit sets `rootDir` to `src`. If `paths` still pointed at other
    // packages' sources, tsc would pull them into the program and fail TS6059.
    const offenders: string[] = [];
    for (const workspace of workspaces("packages")) {
      let build: { compilerOptions?: { paths?: Record<string, string[]> } };
      try {
        build = JSON.parse(readFileSync(join(workspace, "tsconfig.build.json"), "utf8"));
      } catch {
        continue;
      }
      const paths = build.compilerOptions?.paths ?? {};
      const keys = Object.keys(paths);
      const expected = [
        (JSON.parse(readFileSync(join(workspace, "package.json"), "utf8")) as { name: string })
          .name,
      ];
      if (
        keys.length !== 2 ||
        !keys.every((key) => expected[0]?.startsWith(key.split("/*")[0] ?? ""))
      ) {
        offenders.push(workspace.replace(ROOT, ""));
      }
    }
    expect(offenders).toEqual([]);
  });
});
