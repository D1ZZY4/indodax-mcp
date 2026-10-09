import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Remove build-machine paths from a published bundle.
 *
 * `bun build --target bun` inlines an absolute `__dirname` for every CommonJS
 * dependency it wraps, so a bundle built under a home directory ships that
 * layout to every consumer. In the current dependency set the affected shims
 * are thread-stream and pino's transport loader, both reachable only when a pino
 * worker transport is configured, which this repository never does. The paths
 * are therefore inert, but they still disclose the maintainer's username and
 * directory layout, so they are rewritten to a relative form before packing.
 *
 * The replacement keeps the variable defined and still resolves relative to
 * whatever directory the bundle runs from, which is the correct behaviour for a
 * worker path and cannot break a code path that never runs.
 */

/**
 * Prefixes to rewrite, longest first so a nested path is not only partially
 * rewritten. The filesystem root and the empty string are rejected: replacing
 * "/" would corrupt every absolute path in the bundle.
 */
function defaultRoots(): string[] {
  const found = new Set<string>();
  const home = process.env.HOME ?? "";
  if (home !== "" && home !== "/") found.add(home);
  const cwd = process.cwd();
  if (cwd !== "" && cwd !== "/") found.add(cwd);
  return [...found].sort((left, right) => right.length - left.length);
}

/** How many build paths were rewritten, so the build reports its work. */
export function sanitizeBundle(bundlePath: string, roots: string[] = defaultRoots()): number {
  const original = readFileSync(bundlePath, "utf8");
  let text = original;
  let replaced = 0;
  for (const root of roots) {
    if (root === "" || root === "/") continue;
    const needle = `${root}/`;
    const parts = text.split(needle);
    if (parts.length > 1) {
      replaced += parts.length - 1;
      text = parts.join("./");
    }
  }
  if (text !== original) writeFileSync(bundlePath, text);
  return replaced;
}

if (import.meta.main) {
  const target = process.argv[2];
  if (target === undefined) {
    console.error("usage: sanitize-bundle.ts <path/to/bundle.js>");
    process.exit(1);
  }
  const replaced = sanitizeBundle(resolve(target));
  console.log(`sanitized ${replaced} build path(s) in ${target}`);
}
