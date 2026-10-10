/**
 * Runtime preload entry: installed before the daemon's module graph.
 *
 * Bun resolves `preload` before the entrypoint, which is the only point early
 * enough to matter. Composing the application takes roughly 190ms on a cold
 * start, and the bundler hoists the whole graph, so handlers installed from
 * main() run after that window. A SIGTERM from a supervisor or a container stop
 * inside it kills the process by default disposition instead of running the
 * shutdown hooks.
 *
 * This module is preloaded rather than imported. The published binary loads it
 * by absolute path resolved from its own location, so it works both from a
 * checkout and from a global install.
 */
let requested = false;
let handler: (() => void) | null = null;

/** Register the real shutdown routine and drain any signal seen during boot. */
export function onShutdownRequested(fn: () => void): void {
  handler = fn;
  if (!requested) return;
  requested = false;
  fn();
}

function onSignal(): void {
  // Before main registers, defer rather than exit: the shutdown routine and the
  // scheduler it stops do not exist yet.
  if (handler === null) {
    requested = true;
    return;
  }
  handler();
}

process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);
