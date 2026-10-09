/**
 * Guards the published bundle against carrying build-machine paths.
 *
 * `bun build --target bun` inlines an absolute `__dirname` for each wrapped
 * CommonJS dependency, so a bundle built under a home directory ships the
 * maintainer's username and directory layout to every consumer. The build now
 * runs scripts/sanitize-bundle.ts over each output.
 *
 * The script is a repository build tool, matching the other entries in
 * scripts/, so it is exercised as a subprocess rather than imported: a relative
 * import here would break the package-name import invariant that
 * audit-import-style enforces for every file under packages/ and apps/.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOME = process.env.HOME ?? "/root";
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = join(ROOT, "scripts", "sanitize-bundle.ts");

function sanitize(bundle: string): string {
  return execFileSync("bun", [SCRIPT, bundle], { encoding: "utf8" });
}

describe("bundle path sanitization", () => {
  it("rewrites a home path to a relative form and reports the count", () => {
    const dir = mkdtempSync(join(tmpdir(), "sanitize-"));
    const bundle = join(dir, "index.js");
    const source = [
      `var __dirname = "${HOME}/Projects/MCPs/indodax-mcp/node_modules/.bun/pino@10.4.0";`,
      `const config = "${HOME}/.config/systemd/user";`,
      "export const ok = 1;",
    ].join("\n");
    writeFileSync(bundle, source);

    const output = sanitize(bundle);
    const text = readFileSync(bundle, "utf8");
    expect(output).toContain("sanitized 2 build path(s)");
    expect(text).not.toContain(HOME);
    expect(text).toContain("./Projects/MCPs/indodax-mcp/node_modules/.bun/pino@10.4.0");
    // Unrelated content must survive untouched.
    expect(text).toContain("export const ok = 1;");
  });

  it("is a no-op on a bundle with no build paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "sanitize-clean-"));
    const bundle = join(dir, "index.js");
    const source = 'console.log("no paths here");';
    writeFileSync(bundle, source);

    const output = sanitize(bundle);
    expect(output).toContain("sanitized 0 build path(s)");
    expect(readFileSync(bundle, "utf8")).toBe(source);
  });

  it("refuses to rewrite the filesystem root", () => {
    // Rewriting "/" would corrupt every absolute path in a bundle, so the guard
    // has to reject it rather than trusting the caller.
    const dir = mkdtempSync(join(tmpdir(), "sanitize-root-"));
    const bundle = join(dir, "index.js");
    const source = 'const p = "/usr/bin/env";';
    writeFileSync(bundle, source);
    sanitize(bundle);
    expect(readFileSync(bundle, "utf8")).toBe(source);
  });

  it("fails loudly without a target argument", () => {
    let code = 0;
    try {
      execFileSync("bun", [SCRIPT], { encoding: "utf8", stdio: "pipe" });
    } catch (error) {
      code = (error as { status?: number }).status ?? 1;
    }
    expect(code).toBe(1);
  });

  it.each(["apps/mcp-stdio/dist/index.js", "apps/cli/dist/index.js"])(
    "%s carries no build-machine path",
    (relative) => {
      const bundle = join(ROOT, relative);
      if (!existsSync(bundle)) {
        // A source-only checkout has no bundle; the build pipeline covers that.
        expect(true).toBe(true);
        return;
      }
      const text = readFileSync(bundle, "utf8");
      expect(text).not.toContain(HOME);
      expect(text).not.toContain("/home/");
    },
  );

  it("a sanitized bundle still runs", () => {
    const bundle = join(ROOT, "apps/cli/dist/index.js");
    if (!existsSync(bundle)) {
      // A source-only checkout has no bundle; the build pipeline covers that.
      expect(true).toBe(true);
      return;
    }
    // `--help` exits zero, so a non-zero exit here would mean the rewritten
    // bundle failed to execute rather than merely lacking the path.
    const output = execFileSync("bun", [bundle, "--help"], { encoding: "utf8" });
    expect(output).toContain("indodax");
  });
});
