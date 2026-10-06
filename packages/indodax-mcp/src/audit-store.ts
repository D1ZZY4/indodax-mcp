import type { AuditTrail } from "@indodax-mcp/indodax-audit";
import { DrizzleAuditRepository, connectDatabase } from "@indodax-mcp/db";
import type { AppServices } from "@indodax-mcp/indodax-mcp/composition";
import { persistenceCause } from "@indodax-mcp/indodax-mcp/persist-error";
import {
  noteStoreConnected,
  noteStoreFailure,
  noteWriteOutcome,
} from "@indodax-mcp/indodax-mcp/persistence-state";
import type { PersistenceHealth } from "@indodax-mcp/indodax-mcp/state-store";

/**
 * Best-effort audit persistence. The in-memory trail stays primary and
 * nothing changes when DATABASE_URL is absent. When configured, every
 * record is also appended to Postgres; a failing append is logged and
 * never breaks trading.
 */
export function attachAuditPersistence(app: AppServices, health: PersistenceHealth): void {
  const url = app.env.DATABASE_URL;
  if (!url) return;
  let repo: DrizzleAuditRepository;
  let close: () => Promise<void>;
  try {
    const connection = connectDatabase(url);
    close = connection.close;
    repo = new DrizzleAuditRepository(connection.db);
  } catch (error) {
    // The audit mirror never attached, so record it as failed. Without this the
    // rollup could be promoted to "connected" by another store's write and a
    // restart would silently lose the audit trail.
    noteStoreFailure("audit", persistenceCause(error));
    app.logger.warn(
      { error: String(error), cause: persistenceCause(error) },
      "audit persistence disabled, keeping memory trail",
    );
    return;
  }
  noteStoreConnected("audit");
  app.shutdownHooks.push(async () => {
    await close();
  });
  const trail: AuditTrail = app.audit;
  const record = trail.record.bind(trail);
  trail.record = (entry: Parameters<typeof record>[0]) => {
    record(entry);
    const stored = trail.list().at(-1);
    if (!stored) return;
    void repo
      .append({
        eventId: stored.eventId,
        correlationId: stored.correlationId,
        kind: stored.kind,
        decision: stored.decision,
        result: stored.result,
        reason: stored.reason,
      })
      .then(
        () => {
          noteWriteOutcome("audit", true);
        },
        (error: unknown) => {
          // Audit is the mirror most likely to write often, so a failure here is
          // the earliest evidence that the pool is writing nowhere.
          noteWriteOutcome("audit", false);
          noteStoreFailure("audit", persistenceCause(error));
          health.refresh();
          app.logger.warn(
            { error: String(error), cause: persistenceCause(error) },
            "audit persistence failed, keeping memory trail",
          );
        },
      );
  };
}
