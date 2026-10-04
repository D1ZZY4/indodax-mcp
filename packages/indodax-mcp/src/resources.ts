import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { cacheSize } from "@indodax-mcp/indodax-market";
import type { AppServices } from "./composition.js";

export function registerResources(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  const defs = [
    {
      uri: "market://snapshot",
      name: "market-snapshot",
      title: "Market snapshot",
      description: "Latest cached ticker count plus live server time.",
    },
    {
      uri: "pairs://metadata",
      name: "pair-metadata",
      title: "Pair metadata",
      description: "Live pair list with minimums, precisions, and fees.",
    },
    {
      uri: "account://snapshot",
      name: "account-snapshot",
      title: "Account snapshot",
      description: "Balances and permissions. Needs credentials.",
    },
    {
      uri: "orders://open",
      name: "open-orders",
      title: "Open orders",
      description: "Open paper orders in local state.",
    },
    {
      uri: "portfolio://state",
      name: "portfolio-state",
      title: "Portfolio state",
      description: "Paper balances plus trade counts.",
    },
    {
      uri: "risk://state",
      name: "risk-state",
      title: "Risk state",
      description: "Limits, policy, and Deadman state.",
    },
    {
      uri: "reconciliation://state",
      name: "reconciliation-state",
      title: "Reconciliation state",
      description: "Ledger consistency summary.",
    },
    {
      uri: "audit://recent",
      name: "recent-audit",
      title: "Recent audit",
      description: "Latest audit entries without secrets.",
    },
    {
      uri: "alerts://active",
      name: "active-alerts",
      title: "Active alerts",
      description: "Active price alerts with conditions and trigger state.",
    },
    {
      uri: "system://health",
      name: "system-health",
      title: "System health",
      description: "Health rollup and capability matrix.",
    },
    {
      uri: "websocket://state",
      name: "websocket-state",
      title: "WebSocket state",
      description: "Socket connection states and subscriptions.",
    },
    {
      uri: "capabilities://matrix",
      name: "capability-matrix",
      title: "Capability matrix",
      description: "Which operations are allowed or locked.",
    },
  ];
  for (const def of defs) registry.registerResource(def);

  handlers.resources.set("market://snapshot", async () => {
    const time = await app.publicClient.serverTime().catch(() => null);
    return JSON.stringify({ cachedTickers: cacheSize(), serverTime: time });
  });
  handlers.resources.set("pairs://metadata", async () =>
    JSON.stringify(await app.publicClient.pairs()),
  );
  handlers.resources.set("account://snapshot", async () => {
    if (!app.accountClient) return JSON.stringify({ error: "credentials required" });
    return JSON.stringify(await app.accountClient.getAccount());
  });
  handlers.resources.set("orders://open", async () => JSON.stringify(app.paper.openOrders()));
  handlers.resources.set("portfolio://state", async () =>
    JSON.stringify({
      balances: app.paper.snapshot().balances,
      tradeCount: app.paper.snapshot().tradeCount,
    }),
  );
  handlers.resources.set("risk://state", async () =>
    JSON.stringify({ policy: app.policy, deadman: app.deadman.snapshot() }),
  );
  handlers.resources.set("reconciliation://state", async () => {
    const snapshot = app.paper.snapshot();
    return JSON.stringify({
      scope: "paper-local",
      openOrders: snapshot.orders.filter((order) => order.state === "ACCEPTED").length,
      fills: snapshot.orders.filter((order) => order.state === "FILLED").length,
      tradeCount: snapshot.tradeCount,
      note: "paper ledger counts only; use reconcile tools for exchange comparison",
    });
  });
  handlers.resources.set("audit://recent", async () => JSON.stringify(app.audit.list().slice(-20)));
  handlers.resources.set("alerts://active", async () => JSON.stringify(app.alerts.list()));
  handlers.resources.set("system://health", async () =>
    JSON.stringify({ status: app.health.overall(), components: app.health.snapshot() }),
  );
  handlers.resources.set("websocket://state", async () =>
    JSON.stringify({
      market: app.marketSocket.connectionState,
      private: app.privateChannel.connectionState,
    }),
  );
  handlers.resources.set("capabilities://matrix", async () =>
    JSON.stringify({
      "market.read": true,
      "account.read": app.accountClient !== null,
      "trade.place":
        app.env.APP_ENV === "live" &&
        app.env.TRADE_ENABLED === true &&
        app.policy.allowedModes.includes("live") &&
        app.accountClient !== null,
      "funding.withdraw": false,
    }),
  );
}
