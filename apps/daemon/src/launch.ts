/**
 * Built entrypoint for the packed daemon.
 *
 * The published `indodax-daemon` binary must install its signal handlers before
 * the main graph loads, and a shebang cannot carry arguments: `#!/usr/bin/env
 * bun --preload x` makes env look for a program literally named "bun --preload
 * x", which fails to start at all. A bunfig.toml cannot do it either, because
 * Bun resolves that file against the working directory, so a globally installed
 * package would resolve the preload path against the consumer's cwd and refuse
 * to boot.
 *
 * A tiny launcher solves both: it resolves its own directory, so it works from a
 * checkout and from a global install, and it hands the preload and the real
 * entrypoint to bun explicitly.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

await Bun.spawn({
  cmd: [
    process.execPath,
    "--preload",
    join(here, "signals.js"),
    join(here, "index.js"),
    ...process.argv.slice(2),
  ],
  stdio: ["inherit", "inherit", "inherit"],
  env: process.env,
}).exited.then((code) => {
  process.exit(code);
});
