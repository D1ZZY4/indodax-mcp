import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const PUBLISHABLE = ["apps/mcp-stdio", "apps/cli"];

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function check(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
}

async function run(
  command: string[],
  cwd: string,
  input?: string,
): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(command, {
    cwd,
    stdin: input ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (input && proc.stdin) {
    proc.stdin.write(input);
    void proc.stdin.end();
  }
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { code, out: `${out}\n${err}` };
}

for (const dir of PUBLISHABLE) {
  const manifest = JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8")) as {
    name: string;
    version: string;
    bin?: Record<string, string>;
  };
  const pack = Bun.spawnSync(["bun", "pm", "pack", "--destination", tmpdir()], {
    cwd: join(ROOT, dir),
  });
  if (pack.exitCode !== 0) {
    check(`${manifest.name} pack`, false, pack.stderr.toString().slice(0, 200));
    continue;
  }
  const tarball = join(
    tmpdir(),
    `${manifest.name.replace("@", "").replace("/", "-")}-${manifest.version}.tgz`,
  );
  const { existsSync: tarballExists } = await import("node:fs");
  check(`${manifest.name} pack`, tarballExists(tarball), tarball);
  if (!tarballExists(tarball)) continue;
  const listed = Bun.spawnSync(["tar", "tzf", tarball], { cwd: ROOT });
  const contents = listed.stdout.toString();
  check(
    `${manifest.name} tarball entrypoint`,
    contents.includes("package/dist/index.js"),
    "dist/index.js in tarball",
  );

  const sandbox = mkdtempSync(join(tmpdir(), "consumer-"));
  Bun.spawnSync(["bun", "init", "-y"], { cwd: sandbox });
  const install = Bun.spawnSync(["bun", "add", tarball], { cwd: sandbox });
  check(`${manifest.name} install`, install.exitCode === 0, `sandbox ${sandbox}`);

  const binName = Object.keys(manifest.bin ?? {})[0];
  if (binName) {
    const binPath = join(sandbox, "node_modules", ".bin", binName);
    const direct = Bun.spawnSync([binPath, "--help"], { cwd: sandbox });
    check(
      `${manifest.name} bin`,
      direct.exitCode === 0,
      `${binName} --help exit ${direct.exitCode}`,
    );
  }

  const hasEntry = (manifest as { exports?: unknown }).exports !== undefined;
  if (hasEntry) {
    const importCheck = Bun.spawnSync(
      ["bun", "-e", `import("${manifest.name}").then(() => console.log("import ok"))`],
      { cwd: sandbox },
    );
    check(
      `${manifest.name} runtime import`,
      importCheck.exitCode === 0,
      importCheck.stdout.toString().trim().slice(0, 80) ||
        importCheck.stderr.toString().slice(0, 120),
    );
  } else {
    check(`${manifest.name} runtime import`, true, "bin-only package, import not applicable");
  }
}

const mcpInit = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "c", version: "0" },
  },
});
const sandboxBin = mkdtempSync(join(tmpdir(), "consumer-mcp-"));
const tarballMcp = join(tmpdir(), "indodax-mcp-1.0.0.tgz");
{
  const packMcp = Bun.spawnSync(["bun", "pm", "pack", "--destination", tmpdir()], {
    cwd: join(ROOT, "apps/mcp-stdio"),
  });
  if (packMcp.exitCode !== 0) {
    check("indodax-mcp pack", false, "pack failed");
  } else {
    Bun.spawnSync(["bun", "init", "-y"], { cwd: sandboxBin });
    Bun.spawnSync(["bun", "add", tarballMcp], { cwd: sandboxBin });
    const serverBin = join(sandboxBin, "node_modules", ".bin", "indodax-mcp");
    const probe = await run([serverBin], sandboxBin, `${mcpInit}\n`);
    check(
      "indodax-mcp stdio startup",
      probe.out.includes("serverInfo") && probe.out.includes("indodax-mcp"),
      probe.out.slice(0, 120),
    );
  }
}

const failed = results.filter((result) => !result.ok);
console.log(`consumer checks: ${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exit(1);
