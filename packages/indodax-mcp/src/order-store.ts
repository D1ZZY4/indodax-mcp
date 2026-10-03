import { DrizzlePaperLedgerRepository, connectDatabase } from "@indodax-mcp/db";
import type { ExecutionRequest, ExecutionResult } from "@indodax-mcp/indodax-execution";
import type { AppServices } from "./composition.js";

/**
 * Durable paper ledger. The in-memory PaperExecutor stays primary so the
 * server works without a database. When DATABASE_URL is configured, every
 * mutation is mirrored to Postgres and the latest snapshot is reloaded on
 * boot (restart recovery). A failing write is logged and never breaks
 * trading; boot keeps a fresh ledger when no snapshot exists or the
 * stored shape is invalid.
 */
export function attachPaperPersistence(app: AppServices): void {
  const url = app.env.DATABASE_URL;
  if (!url) return;
  void (async () => {
    let repo: DrizzlePaperLedgerRepository;
    let tenantId: string;
    let close: () => Promise<void>;
    try {
      const connection = connectDatabase(url);
      close = connection.close;
      repo = new DrizzlePaperLedgerRepository(connection.db);
      tenantId = await repo.ensureTenant("local");
      const stored = await repo.load(tenantId);
      if (stored !== null) {
        try {
          app.paper.restore(stored);
          app.logger.info("paper ledger restored from database");
        } catch {
          app.logger.warn("stored paper snapshot invalid, starting with a fresh ledger");
        }
      }
    } catch (error) {
      app.logger.warn(
        { error: String(error) },
        "paper persistence disabled, keeping memory ledger",
      );
      return;
    }
    app.shutdownHooks.push(async () => {
      await close();
    });
    const persist = (): void => {
      repo.save(tenantId, app.paper.snapshot()).catch((error: unknown) => {
        app.logger.warn(
          { error: String(error) },
          "paper persistence failed, keeping memory ledger",
        );
      });
    };
    const paper = app.paper;
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
  })();
}
