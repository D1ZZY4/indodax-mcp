import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

interface InventoryEntry {
  package: string;
  version: string;
  path: string;
  publishable: boolean;
  buildStatus: "built" | "missing";
  entrypoints: string[];
  outputs: string[];
  exportMap: Record<string, unknown> | null;
  binaryNames: string[];
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function listOutputs(dir: string, base = ""): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listOutputs(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

export function buildInventory(): InventoryEntry[] {
  const entries: InventoryEntry[] = [];
  for (const area of ["apps", "packages"]) {
    const base = join(ROOT, area);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      const manifestPath = join(base, name, "package.json");
      if (!existsSync(manifestPath)) continue;
      const pkg = readJson(manifestPath);
      const outputs = listOutputs(join(base, name, "dist"));
      const bin = pkg.bin as Record<string, string> | string | undefined;
      const entrypoints = new Set<string>();
      if (typeof pkg.main === "string") entrypoints.add(pkg.main);
      if (typeof bin === "string") entrypoints.add(bin);
      else if (bin) for (const target of Object.values(bin)) entrypoints.add(target);
      entries.push({
        package: String(pkg.name ?? name),
        version: String(pkg.version ?? "0.0.0"),
        path: `${area}/${name}`,
        publishable: pkg.private !== true,
        buildStatus: outputs.length > 0 ? "built" : "missing",
        entrypoints: [...entrypoints],
        outputs,
        exportMap: (pkg.exports as Record<string, unknown> | undefined) ?? null,
        binaryNames: typeof bin === "string" ? [] : Object.keys(bin ?? {}),
      });
    }
  }
  return entries.sort((a, b) => a.package.localeCompare(b.package));
}

export function renderMarkdown(entries: InventoryEntry[]): string {
  const lines = [
    "# Build inventory",
    "",
    "| Package | Version | Status | Entrypoints | Outputs | Binaries | Publishable |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const entry of entries) {
    lines.push(
      `| ${entry.package} | ${entry.version} | ${entry.buildStatus} | ${entry.entrypoints.join(", ") || "-"} | ${entry.outputs.length} | ${entry.binaryNames.join(", ") || "-"} | ${entry.publishable} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

if (import.meta.main) {
  const entries = buildInventory();
  const missing = entries.filter((entry) => entry.buildStatus === "missing");
  await Bun.write(join(ROOT, "build-inventory.json"), `${JSON.stringify(entries, null, 2)}\n`);
  await Bun.write(join(ROOT, "build-inventory.md"), renderMarkdown(entries));
  console.log(`inventory: ${entries.length} entries, ${missing.length} missing builds`);
  for (const entry of missing) console.log(`  MISSING: ${entry.package}`);
}
