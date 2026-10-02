import { rm } from "node:fs/promises";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

const TARGETS = [
  "apps/*/dist",
  "packages/*/dist",
  "apps/*/coverage",
  "packages/*/coverage",
  "coverage",
  "test-results",
  "playwright-report",
  ".turbo",
];

async function expand(pattern: string): Promise<string[]> {
  const glob = new Bun.Glob(pattern);
  const out: string[] = [];
  for await (const match of glob.scan({ cwd: ROOT, onlyFiles: false })) {
    out.push(join(ROOT, match));
  }
  return out;
}

let removed = 0;
for (const pattern of TARGETS) {
  for (const path of await expand(pattern)) {
    await rm(path, { recursive: true, force: true });
    removed += 1;
    console.log(`removed ${path.replace(ROOT, "")}`);
  }
}
console.log(`clean done: ${removed} paths removed`);
