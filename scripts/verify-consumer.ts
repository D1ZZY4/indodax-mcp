import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
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

let stdinCounter = 0;

async function run(
  command: string[],
  cwd: string,
  input?: string,
  timeoutMs = 30_000,
): Promise<{ code: number; out: string }> {
  // Framed input goes through a temp file whose descriptor EOFs cleanly.
  // The server is long-lived and may not exit on its own, so every probe
  // ends with SIGTERM and asserts on captured output, never on liveness.
  let inputFile: string | null = null;
  if (input !== undefined) {
    inputFile = join(tmpdir(), `consumer-stdin-${process.pid}-${stdinCounter++}.txt`);
    writeFileSync(inputFile, input);
  }
  const proc = Bun.spawn(command, {
    cwd,
    // The sandbox install must not attach its persistence mirrors to whatever
    // database this shell happens to have configured. These probes check that
    // the packed artifact starts and serves, which needs no database, and
    // inheriting one would make the result depend on that server.
    env: { ...process.env, DATABASE_URL: "" },
    stdin: inputFile === null ? "ignore" : Bun.file(inputFile),
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    const collected = Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await Promise.race([
      collected.then(() => true),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
    try {
      proc.kill();
    } catch {
      // already exited
    }
    const [out, err] = await collected;
    const code = await proc.exited;
    return { code, out: `${out}\n${err}` };
  } finally {
    if (inputFile !== null) unlinkSync(inputFile);
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
const mcpInitialized = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" });
const mcpDocsCall = JSON.stringify({
  jsonrpc: "2.0",
  id: 2,
  method: "tools/call",
  params: { name: "indodax_docs", arguments: {} },
});

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
  check(`${manifest.name} pack`, existsSync(tarball), tarball);
  if (!existsSync(tarball)) continue;
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
    // The bin is a long-lived MCP server, not a --help CLI: run() ends
    // each probe with SIGTERM and framed input, so the check asserts on
    // startup output for the server bin and on exit 0 for the CLI bin.
    // Either signal proves the packed bin executes.
    const binPath = join(sandbox, "node_modules", ".bin", binName);
    const started = await run([binPath, "--help"], sandbox, `${mcpInit}\n`);
    check(
      `${manifest.name} bin`,
      started.out.includes("serving indodax-mcp over stdio") || started.code === 0,
      started.out.slice(0, 120),
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

const sandboxBin = mkdtempSync(join(tmpdir(), "consumer-mcp-"));
{
  const packMcp = Bun.spawnSync(["bun", "pm", "pack", "--destination", tmpdir()], {
    cwd: join(ROOT, "apps/mcp-stdio"),
  });
  // Bun names a packed tarball after the package name and version, both of
  // which change: the scope, the package name, and the version are all part of
  // the filename. Deriving it from the manifest keeps this correct across a
  // rename or a version bump; a hardcoded name silently installs nothing.
  const mcpManifest = JSON.parse(
    readFileSync(join(ROOT, "apps/mcp-stdio/package.json"), "utf8"),
  ) as { name: string; version: string };
  const tarballMcp = join(
    tmpdir(),
    `${mcpManifest.name.replace("@", "").replace("/", "-")}-${mcpManifest.version}.tgz`,
  );
  if (packMcp.exitCode !== 0 || !existsSync(tarballMcp)) {
    check("indodax-mcp pack", false, `pack failed or produced no ${tarballMcp}`);
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
    const docsProbe = await run(
      [serverBin],
      sandboxBin,
      `${mcpInit}\n${mcpInitialized}\n${mcpDocsCall}\n`,
    );
    check(
      "indodax-mcp docs from packed install",
      docsProbe.out.includes('\\"page\\"') && docsProbe.out.includes("market"),
      docsProbe.out.slice(0, 120),
    );
  }
}

const failed = results.filter((result) => !result.ok);
console.log(`consumer checks: ${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exit(1);
