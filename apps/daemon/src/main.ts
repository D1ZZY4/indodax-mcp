import { loadEnv } from "@indodax-mcp/config";
import { createLogger } from "@indodax-mcp/logging";
import { buildIndodaxServer } from "@indodax-mcp/indodax-mcp";
import { getTicker } from "@indodax-mcp/indodax-market";

const env = loadEnv();
const logger = createLogger({ service: "daemon" });
const { app } = buildIndodaxServer(env);

let stopped = false;

async function reconcileOnce(): Promise<void> {
  const open = app.paper.openOrders().length;
  logger.info({ open }, "reconcile: paper orders open at startup");
}

async function marketRefresh(): Promise<void> {
  try {
    const ticker = await getTicker(app.publicClient, "btc_idr");
    await app.events.publish({
      kind: "account.synced",
      accountId: app.accountId,
      at: new Date().toISOString(),
    });
    logger.info({ price: ticker.last }, "market refresh");
  } catch (error) {
    logger.warn({ error: String(error) }, "market refresh failed");
  }
}

async function snapshot(): Promise<void> {
  logger.info(
    { open: app.paper.openOrders().length, metrics: app.metrics.snapshot() },
    "daemon snapshot",
  );
}

async function main(): Promise<void> {
  await reconcileOnce();
  app.scheduler.start({ name: "market-refresh", intervalMs: 30_000, task: marketRefresh });
  app.scheduler.start({ name: "snapshot", intervalMs: 60_000, task: snapshot });
  logger.info("daemon ready");

  const shutdown = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    app.scheduler.stopAll();
    logger.info("daemon shutdown complete");
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  await new Promise(() => {});
}

await main();
