import { DrizzlePaperLedgerRepository, connectDatabase } from "@indodax-mcp/db";
import type { ExecutionRequest, ExecutionResult } from "@indodax-mcp/indodax-execution";
import type { AppServices } from "@indodax-mcp/indodax-mcp/composition";
import { persistenceCause, resolveBootSnapshot } from "@indodax-mcp/indodax-mcp/persist-error";
import {
  noteStoreConnected,
  noteStoreFailure,
  noteWriteOutcome,
} from "@indodax-mcp/indodax-mcp/persistence-state";
import type { PersistenceHealth } from "@indodax-mcp/indodax-mcp/state-store";

/**
 * Durable paper ledger. The in-memory PaperExecutor stays primary so the
 * server works without a database. When DATABASE_URL is configured, every
 * mutation is mirrored to Postgres and the latest snapshot is reloaded on
 * boot (restart recovery). A failing write is logged and never breaks
 * trading; boot keeps a fresh ledger when no snapshot exists or the
 * stored shape is invalid.
 *
 * Boot race: patches are installed synchronously so mutations during boot
 * are captured. Restore applies only on a clean boot; when mutations
 * landed first, memory wins and is mirrored out instead of overwritten.
 */
export function attachPaperPersistence(app: AppServices, health: PersistenceHealth): void {
  const url = app.env.DATABASE_URL;
  if (!url) return;
  const paper = app.paper;
  let repo: DrizzlePaperLedgerRepository | null = null;
  let tenantId = "";
  let ready = false;
  let bootDirty = false;
  const flush = (): void => {
    if (!ready || repo === null) return;
    repo.save(tenantId, paper.snapshot()).then(
      () => {
        noteWriteOutcome("paper", true);
      },
      (error: unknown) => {
        noteWriteOutcome("paper", false);
        noteStoreFailure("paper", persistenceCause(error));
        health.refresh();
        app.logger.warn(
          { error: String(error), cause: persistenceCause(error) },
          "paper persistence failed, keeping memory ledger",
        );
      },
    );
  };
  const persist = (): void => {
    bootDirty = true;
    flush();
  };
  const submit = paper.submit.bind(paper);
  paper.submit = async (request: ExecutionRequest): Promise<ExecutionResult> => {
    const result = await submit(request);
    persist();
    return result;
  };
  const cancel = paper.cancel.bind(paper);
  paper.cancel = async (internalOrderId: string): Promise<boolean> => {
    const result = await cancel(internalOrderId);
    if (result) persist();
    return result;
  };
  const fill = paper.fill.bind(paper);
  paper.fill = (internalOrderId: string, fillPrice: string): { fee: string } => {
    const result = fill(internalOrderId, fillPrice);
    persist();
    return result;
  };
  const reset = paper.reset.bind(paper);
  paper.reset = (): void => {
    reset();
    persist();
  };
  void (async () => {
    try {
      const connection = connectDatabase(url);
      const close = connection.close;
      const repository = new DrizzlePaperLedgerRepository(connection.db);
      const tenant = await repository.ensureTenant("local");
      const stored = await repository.load(tenant);
      const action = resolveBootSnapshot(stored !== null, bootDirty);
      if (action === "restore" && stored !== null) {
        try {
          paper.restore(stored);
          app.logger.info("paper ledger restored from database");
        } catch {
          app.logger.warn("stored paper snapshot invalid, starting with a fresh ledger");
        }
      } else if (action === "keep-local") {
        app.logger.info("paper mutated during boot; memory kept and mirrored to database");
      }
      repo = repository;
      tenantId = tenant;
      ready = true;
      noteStoreConnected("paper");
      health.refresh();
      app.shutdownHooks.push(async () => {
        await close();
      });
      if (bootDirty) flush();
    } catch (error) {
      noteStoreFailure("paper", persistenceCause(error));
      health.refresh();
      app.logger.warn(
        { error: String(error), cause: persistenceCause(error) },
        "paper persistence disabled, keeping memory ledger",
      );
    }
  })();
}
