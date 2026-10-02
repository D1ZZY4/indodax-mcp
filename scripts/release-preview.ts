import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

interface PackageReport {
  name: string;
  version: string;
  path: string;
  publishable: boolean;
  entrypoints: string[];
  outputs: string[];
  exportMap: Record<string, unknown> | null;
  binaries: Record<string, string> | null;
  dependencies: Record<string, string>;
}

const FORBIDDEN_IN_PACKAGES = [
  "test",
  "tests",
  "coverage",
  "playwright-report",
  "test-results",
  ".turbo",
  ".github",
  ".env",
  ".env.local",
];

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as unknown as Record<string, unknown>;
}

function listFiles(dir: string, base = ""): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = base ? `${base}/${entry}` : entry;
    if (statSync(full).isDirectory()) out.push(...listFiles(full, rel));
    else out.push(rel);
  }
  return out.sort();
}

function entrypointsOf(pkg: Record<string, unknown>): string[] {
  const entries = new Set<string>();
  const main = pkg.main;
  if (typeof main === "string") entries.add(main);
  const bin = pkg.bin as Record<string, string> | string | undefined;
  if (typeof bin === "string") entries.add(bin);
  else if (bin) for (const target of Object.values(bin)) entries.add(target);
  return [...entries];
}

export function inspectWorkspace(_dir: string): PackageReport[] {
  const reports: PackageReport[] = [];
  const manifest = readJson(join(ROOT, "package.json")) as {
    workspaces?: string[];
  };
  const patterns = manifest.workspaces ?? [];
  for (const pattern of patterns) {
    const base = pattern.replace("/*", "");
    if (!existsSync(join(ROOT, base))) continue;
    for (const name of readdirSync(join(ROOT, base))) {
      const pkgDir = join(ROOT, base, name);
      const manifestPath = join(pkgDir, "package.json");
      if (!existsSync(manifestPath)) continue;
      let pkg: Record<string, unknown>;
      try {
        pkg = readJson(manifestPath);
      } catch {
        continue;
      }
      const publishable = pkg.private !== true;
      reports.push({
        name: String(pkg.name ?? name),
        version: String(pkg.version ?? "0.0.0"),
        path: `${base}/${name}`,
        publishable,
        entrypoints: entrypointsOf(pkg),
        outputs: listFiles(join(pkgDir, "dist")),
        exportMap: (pkg.exports as Record<string, unknown> | undefined) ?? null,
        binaries: (pkg.bin as Record<string, string> | undefined) ?? null,
        dependencies: {
          ...((pkg.dependencies as Record<string, string> | undefined) ?? {}),
          ...((pkg.devDependencies as Record<string, string> | undefined) ?? {}),
        },
      });
    }
  }
  return reports.sort((a, b) => a.name.localeCompare(b.name));
}

export function checkForbiddenFiles(report: PackageReport): string[] {
  return report.outputs.filter((file) =>
    FORBIDDEN_IN_PACKAGES.some(
      (forbidden) => file === forbidden || file.startsWith(`${forbidden}/`),
    ),
  );
}

if (import.meta.main) {
  const reports = inspectWorkspace(ROOT);
  const publishable = reports.filter((report) => report.publishable);
  console.log(`workspaces: ${reports.length}, publishable: ${publishable.length}`);
  for (const report of publishable) {
    console.log(`- ${report.name}@${report.version} (${report.path})`);
    console.log(`  entrypoints: ${report.entrypoints.join(", ") || "none"}`);
    console.log(`  outputs: ${report.outputs.length} files`);
    console.log(`  binaries: ${JSON.stringify(report.binaries)}`);
    const forbidden = checkForbiddenFiles(report);
    if (forbidden.length > 0) console.log(`  FORBIDDEN: ${forbidden.join(", ")}`);
  }
}
