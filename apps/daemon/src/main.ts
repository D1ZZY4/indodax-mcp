import { loadConfig } from "@indodax-mcp/config";
import { createLogger } from "@indodax-mcp/logging";
import { buildIndodaxServer } from "@indodax-mcp/indodax-mcp";
import { decimalOrNull } from "@indodax-mcp/core";
import { getTicker } from "@indodax-mcp/indodax-market";

const { diagnostic, env } = loadConfig();
const logger = createLogger({ service: "daemon" });
const { app } = buildIndodaxServer(env, diagnostic);

let stopped = false;

async function reconcileOnce(): Promise<void> {
  const open = app.paper.openOrders();
  logger.info({ open: open.length }, "reconcile: paper orders open at startup");
  for (const order of open) {
    try {
      const ticker = await getTicker(
        app.publicClient,
        `${order.symbol.base}_${order.symbol.quote}`,
      );
      const market = decimalOrNull(ticker.last);
      const limit = decimalOrNull(order.price ?? "0");
      if (!market || !limit) continue;
      const fillable = order.side === "BUY" ? market.lte(limit) : market.gte(limit);
      if (fillable) {
        logger.info(
          {
            orderId: order.internalOrderId,
            limit: limit.toString(),
            market: market.toString(),
          },
          "reconcile: paper order fillable at live price",
        );
      }
    } catch (error) {
      logger.warn({ error: String(error) }, "reconcile: market read failed");
    }
  }
}

async function marketRefresh(): Promise<void> {
  try {
    const ticker = await getTicker(app.publicClient, "btc_idr");
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
    for (const hook of app.shutdownHooks) {
      try {
        await hook();
      } catch (error) {
        logger.warn({ error: String(error) }, "daemon shutdown hook failed");
      }
    }
    logger.info("daemon shutdown complete");
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  await new Promise(() => {});
}

await main();
