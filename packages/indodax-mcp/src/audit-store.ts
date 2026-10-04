import type { AuditTrail } from "@indodax-mcp/indodax-audit";
import { DrizzleAuditRepository, connectDatabase } from "@indodax-mcp/db";
import type { AppServices } from "./composition.js";

/**
 * Best-effort audit persistence. The in-memory trail stays primary and
 * nothing changes when DATABASE_URL is absent. When configured, every
 * record is also appended to Postgres; a failing append is logged and
 * never breaks trading.
 */
export function attachAuditPersistence(app: AppServices): void {
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
      { error: String(error), cause: causeOf(error) },
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
          { error: String(error), cause: causeOf(error) },
          "audit persistence failed, keeping memory trail",
        );
      });
  };
}

/** Underlying driver cause (e.g. connection refused) without connection secrets. */
function causeOf(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error).slice(0, 200);
  const cause = (error as { cause?: unknown }).cause;
  return String(cause ?? error).slice(0, 200);
}
