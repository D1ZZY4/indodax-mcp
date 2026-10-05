/** Underlying driver cause without connection secrets. */
export function persistenceCause(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error).slice(0, 200);
  const cause = (error as { cause?: unknown }).cause;
  return String(cause ?? error).slice(0, 200);
}

export type BootSnapshotAction = "restore" | "keep-local" | "fresh";

/**
 * Boot race policy for memory-first mirrors. Snapshots are full state, so
 * last-write-wins is safe: restore only when nothing mutated during boot.
 * When mutations landed before the stored snapshot arrived, the live
 * in-memory state wins and is mirrored out instead of being overwritten.
 */
export function resolveBootSnapshot(hasStored: boolean, bootDirty: boolean): BootSnapshotAction {
  if (!hasStored) return "fresh";
  return bootDirty ? "keep-local" : "restore";
}
