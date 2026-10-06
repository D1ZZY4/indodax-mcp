import type { AuditTrail } from "@indodax-mcp/indodax-audit";
import { DrizzleAuditRepository, connectDatabase } from "@indodax-mcp/db";
import type { AppServices } from "@indodax-mcp/indodax-mcp/composition";
import { persistenceCause } from "@indodax-mcp/indodax-mcp/persist-error";
import { noteConnected, noteFailure } from "@indodax-mcp/indodax-mcp/persistence-state";
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
    app.logger.warn(
      { error: String(error), cause: persistenceCause(error) },
      "audit persistence disabled, keeping memory trail",
    );
    return;
  }
  app.shutdownHooks.push(async () => {
    await close();
  });
  const trail: AuditTrail = app.audit;
  const record = trail.record.bind(trail);
  trail.record = (entry) => {
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
      .catch((error: unknown) => {
        app.logger.warn(
          { error: String(error), cause: persistenceCause(error) },
          "audit persistence failed, keeping memory trail",
        );
      });
  };
}
