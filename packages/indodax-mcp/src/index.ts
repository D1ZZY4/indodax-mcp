import { Registry } from "@d1zzy4-jethools/mcp-registry";
import { buildServer, sendResourceUpdated } from "@d1zzy4-jethools/mcp-core";
import type { ServerHandlers } from "@d1zzy4-jethools/mcp-core";
import { createApp, type AppServices } from "@d1zzy4-jethools/mcp-app/composition";
import { buildGuard } from "@d1zzy4-jethools/mcp-app/guard";
import { attachAuditPersistence } from "@d1zzy4-jethools/mcp-app/audit-store";
import { attachPaperPersistence } from "@d1zzy4-jethools/mcp-app/order-store";
import {
  attachAlertPersistence,
  attachDeadmanPersistence,
  attachStopPersistence,
} from "@d1zzy4-jethools/mcp-app/state-store";
import { evaluateAlerts } from "@d1zzy4-jethools/mcp-app/tools/alerts";
import type { PersistenceReport } from "@d1zzy4-jethools/mcp-app/persistence-state";
import {
  noteConfigured,
  noteUnconfigured,
  refreshPersistenceState,
} from "@d1zzy4-jethools/mcp-app/persistence-state";
import { evaluateStops } from "@d1zzy4-jethools/mcp-app/tools/stop";
import { registerMarketTools } from "@d1zzy4-jethools/mcp-app/tools/market";
import { registerCandlesTool } from "@d1zzy4-jethools/mcp-app/tools/candles";
import { registerMarketScanTools } from "@d1zzy4-jethools/mcp-app/tools/market-scan";
import { registerAccountTools } from "@d1zzy4-jethools/mcp-app/tools/account";
import { registerOrderTools } from "@d1zzy4-jethools/mcp-app/tools/orders";
import { registerPortfolioTools } from "@d1zzy4-jethools/mcp-app/tools/portfolio";
import { registerRiskTools } from "@d1zzy4-jethools/mcp-app/tools/risk";
import { registerPaperTools } from "@d1zzy4-jethools/mcp-app/tools/paper";
import { registerStrategyTools } from "@d1zzy4-jethools/mcp-app/tools/strategy";
import { registerReconcileTools } from "@d1zzy4-jethools/mcp-app/tools/reconcile";
import { registerAuditTools } from "@d1zzy4-jethools/mcp-app/tools/audit";
import { registerAlertTools } from "@d1zzy4-jethools/mcp-app/tools/alerts";
import { registerSystemTools } from "@d1zzy4-jethools/mcp-app/tools/system";
import { registerFundingTools } from "@d1zzy4-jethools/mcp-app/tools/funding";
import { registerHistoryTools } from "@d1zzy4-jethools/mcp-app/tools/history";
import { registerOpsTools } from "@d1zzy4-jethools/mcp-app/tools/ops";
import { registerSocketTools } from "@d1zzy4-jethools/mcp-app/tools/ops-sockets";
import { registerQuoteTools } from "@d1zzy4-jethools/mcp-app/tools/quote";
import { registerSymbolTools } from "@d1zzy4-jethools/mcp-app/tools/symbols";
import { registerPositionTools } from "@d1zzy4-jethools/mcp-app/tools/positions";
import { registerSnapshotTools } from "@d1zzy4-jethools/mcp-app/tools/snapshot";
import { registerRoundingTools } from "@d1zzy4-jethools/mcp-app/tools/rounding";
import { registerOcoTools } from "@d1zzy4-jethools/mcp-app/tools/oco";
import { registerOcoAttachTools } from "@d1zzy4-jethools/mcp-app/tools/oco-attach";
import { registerDeadmanTools } from "@d1zzy4-jethools/mcp-app/tools/deadman";
import { registerStopTools } from "@d1zzy4-jethools/mcp-app/tools/stop";
import { registerDocsTools } from "@d1zzy4-jethools/mcp-app/tools/docs";
import { registerResources } from "@d1zzy4-jethools/mcp-app/resources";
import { registerPrompts } from "@d1zzy4-jethools/mcp-app/prompts";
import type { AppEnv, ConfigDiagnostic } from "@d1zzy4-jethools/config";

import { SERVER_NAME, SERVER_VERSION } from "@d1zzy4-jethools/mcp-app/version";
export { SERVER_NAME, SERVER_VERSION };

export function emptyHandlers(): ServerHandlers {
  return { tools: new Map(), resources: new Map(), prompts: new Map() };
}

export function buildIndodaxServer(env: AppEnv, diagnostic?: ConfigDiagnostic) {
  const app: AppServices = createApp(env, diagnostic);
  const MIRRORS = ["paper", "audit", "alerts", "stops", "deadman"] as const;
  if (env.DATABASE_URL !== undefined) noteConfigured([...MIRRORS]);
  else noteUnconfigured();
  const health = {
    /** Recompute the database and mirror components from live evidence. */
    refresh: () => refreshPersistenceHealth(app),
  };
  void attachAuditPersistence(app, health);
  void attachPaperPersistence(app, health);
  void attachAlertPersistence(app, health);
  void attachStopPersistence(app, health);
  void attachDeadmanPersistence(app, health);
  app.health.set("configuration", { status: "healthy", detail: "environment parsed" });
  app.health.set("runtime", { status: "healthy", detail: "server composed" });
  app.health.set("mcpTransport", { status: "healthy", detail: "registry built" });
  app.health.set("deadman", { status: "healthy", detail: "disarmed" });
  const registry = new Registry();
  const handlers = emptyHandlers();
  registerMarketTools(registry, handlers, app);
  registerCandlesTool(registry, handlers, app);
  registerMarketScanTools(registry, handlers, app);
  registerAccountTools(registry, handlers, app);
  registerOrderTools(registry, handlers, app);
  registerPortfolioTools(registry, handlers, app);
  registerRiskTools(registry, handlers, app);
  registerPaperTools(registry, handlers, app);
  registerStrategyTools(registry, handlers, app);
  registerReconcileTools(registry, handlers, app);
  registerAuditTools(registry, handlers, app);
  registerAlertTools(registry, handlers, app);
  registerSystemTools(registry, handlers, app);
  registerFundingTools(registry, handlers, app);
  registerHistoryTools(registry, handlers, app);
  registerOpsTools(registry, handlers, app);
  registerSocketTools(registry, handlers, app);
  registerQuoteTools(registry, handlers, app);
  registerSymbolTools(registry, handlers, app);
  registerPositionTools(registry, handlers, app);
  registerSnapshotTools(registry, handlers, app);
  registerRoundingTools(registry, handlers, app);
  registerOcoTools(registry, handlers, app);
  registerOcoAttachTools(registry, handlers, app);
  registerDeadmanTools(registry, handlers, app);
  registerStopTools(registry, handlers, app);
  registerDocsTools(registry, handlers, app);
  registerResources(registry, handlers, app);
  registerPrompts(registry, handlers, app);
  const guard = buildGuard(app);
  const createServer = () =>
    buildServer({
      name: SERVER_NAME,
      version: SERVER_VERSION,
      registry,
      handlers,
      guard,
    });
  const server = createServer();
  startAutopoll(app, server);
  return { server, app, registry, createServer };
}

function startAutopoll(app: AppServices, server: ReturnType<typeof buildServer>): void {
  if (app.env.STOP_AUTOPOLL_MS !== undefined) {
    app.scheduler.start({
      name: "stop-autopoll",
      intervalMs: app.env.STOP_AUTOPOLL_MS,
      task: async () => {
        const { fired } = await evaluateStops(app);
        if (fired.length > 0) {
          app.logger.info({ fired: fired.length }, "stop autopoll fired");
        }
      },
    });
  }
  if (app.env.ALERT_AUTOPOLL_MS !== undefined) {
    app.scheduler.start({
      name: "alert-autopoll",
      intervalMs: app.env.ALERT_AUTOPOLL_MS,
      task: async () => {
        const { triggered } = await evaluateAlerts(app);
        for (const alert of triggered) {
          app.logger.info({ alert: alert.id, pair: alert.pair }, "alert autopoll triggered");
          await notifyAlert(server, alert.id, alert.pair);
        }
      },
    });
  }
  const jobs = app.scheduler.running;
  app.health.set("scheduler", {
    status: "healthy",
    detail: jobs.length > 0 ? `${jobs.join(",")} scheduled` : "no jobs scheduled",
  });
}

/**
 * Recompute the persistence-dependent health components from live evidence.
 *
 * Runs after every mirror attaches and on every health read, so a database
 * that dies after boot stops being reported as healthy. Without this the
 * server could claim a durable mirror while every write was failing.
 */
function refreshPersistenceHealth(app: AppServices): void {
  const report = refreshPersistenceState();
  if (!report.configured) {
    app.health.set("database", {
      status: "unknown",
      detail: "no DATABASE_URL, memory only, a restart loses paper/audit/alerts/stops/deadman",
    });
    return;
  }
  if (report.state === "connected") {
    app.health.set("database", {
      status: "healthy",
      detail: `reachable, mirroring ${report.mirrors.join(",")}`,
    });
    return;
  }
  app.health.set("database", {
    status: "unhealthy",
    detail:
      `configured but unreachable since boot, mirroring ${report.mirrors.join(",")} has no effect, ` +
      `a restart cannot restore ${report.mirrors.join(",")}` +
      (report.lastError === null ? "" : ` (${report.lastError})`),
  });
}

/** Exposed so the config surface reports the same truth as the health rollup. */
export function durability(): PersistenceReport {
  return refreshPersistenceState();
}

/**
 * Push an alert trigger to connected MCP clients. Best-effort: clients
 * that do not listen simply never see it, and a disconnected server
 * must never break the autopoll loop.
 */
async function notifyAlert(
  server: ReturnType<typeof buildServer>,
  id: string,
  pair: string,
): Promise<void> {
  try {
    await server.sendLoggingMessage({
      level: "notice",
      data: { alert: id, pair, event: "triggered" },
    });
    await sendResourceUpdated(server, "alerts://active");
  } catch {
    // notification transport unavailable; the trigger itself already applied
  }
}

export type { AppServices };
