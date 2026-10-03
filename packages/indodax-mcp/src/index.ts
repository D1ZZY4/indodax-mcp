import { Registry } from "@indodax-mcp/mcp-registry";
import { buildServer } from "@indodax-mcp/mcp-core";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { createApp, type AppServices } from "./composition.js";
import { buildGuard } from "./guard.js";
import { attachAuditPersistence } from "./audit-store.js";
import { attachPaperPersistence } from "./order-store.js";
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
  registerResources(registry, handlers, app);
  registerPrompts(registry, handlers, app);
  const server = buildServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    registry,
    handlers,
    guard: buildGuard(app),
  });
  return { server, app, registry };
}

export type { AppServices };
