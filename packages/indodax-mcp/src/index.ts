import { Registry } from "@indodax-mcp/mcp-registry";
import { buildServer, sendResourceUpdated } from "@indodax-mcp/mcp-core";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { createApp, type AppServices } from "./composition.js";
import { buildGuard } from "./guard.js";
import { attachAuditPersistence } from "./audit-store.js";
import { attachPaperPersistence } from "./order-store.js";
import {
  attachAlertPersistence,
  attachDeadmanPersistence,
  attachStopPersistence,
} from "./state-store.js";
import { evaluateAlerts } from "./tools/alerts.js";
import { evaluateStops } from "./tools/stop.js";
import { registerMarketTools } from "./tools/market.js";
import { registerAccountTools } from "./tools/account.js";
import { registerOrderTools } from "./tools/orders.js";
import { registerPortfolioTools } from "./tools/portfolio.js";
import { registerRiskTools } from "./tools/risk.js";
import { registerPaperTools } from "./tools/paper.js";
import { registerStrategyTools } from "./tools/strategy.js";
import { registerReconcileTools } from "./tools/reconcile.js";
import { registerAuditTools } from "./tools/audit.js";
import { registerAlertTools } from "./tools/alerts.js";
import { registerSystemTools } from "./tools/system.js";
import { registerFundingTools } from "./tools/funding.js";
import { registerHistoryTools } from "./tools/history.js";
import { registerOpsTools } from "./tools/ops.js";
import { registerQuoteTools } from "./tools/quote.js";
import { registerDeadmanTools } from "./tools/deadman.js";
import { registerStopTools } from "./tools/stop.js";
import { registerDocsTools } from "./tools/docs.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";
import type { AppEnv } from "@indodax-mcp/config";

export const SERVER_NAME = "indodax-mcp";
export const SERVER_VERSION = "1.0.0";

export function emptyHandlers(): ServerHandlers {
  return { tools: new Map(), resources: new Map(), prompts: new Map() };
}

export function buildIndodaxServer(env: AppEnv) {
  const app: AppServices = createApp(env);
  void attachAuditPersistence(app);
  void attachPaperPersistence(app);
  void attachAlertPersistence(app);
  void attachStopPersistence(app);
  void attachDeadmanPersistence(app);
  app.health.set("configuration", { status: "healthy", detail: "environment parsed" });
  app.health.set("runtime", { status: "healthy", detail: "server composed" });
  app.health.set("mcpTransport", { status: "healthy", detail: "registry built" });
  app.health.set("deadman", { status: "healthy", detail: "disarmed" });
  const registry = new Registry();
  const handlers = emptyHandlers();
  registerMarketTools(registry, handlers, app);
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
  registerQuoteTools(registry, handlers, app);
  registerDeadmanTools(registry, handlers, app);
  registerStopTools(registry, handlers, app);
  registerDocsTools(registry, handlers, app);
  registerResources(registry, handlers, app);
  registerPrompts(registry, handlers, app);
  const server = buildServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    registry,
    handlers,
    guard: buildGuard(app),
  });
  startAutopoll(app, server);
  return { server, app, registry };
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
