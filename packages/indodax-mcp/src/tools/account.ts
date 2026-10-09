import { z } from "zod";
import { AuthenticationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { toBalanceViews } from "@indodax-mcp/indodax-account";
import { fail, ok } from "@indodax-mcp/mcp-app/respond";
import type { AppServices } from "@indodax-mcp/mcp-app/composition";

export function registerAccountTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool({
    metadata: {
      name: "indodax_account",
      title: "Account information",
      description:
        "Read-only, needs credentials. Account identity, permissions, and all balances. Fails cleanly without credentials.",
      capability: "READ",
      riskClass: "read",
      environmentRequirement: "any",
      authRequirement: "credentials",
      destructive: false,
      idempotencyClass: "none",
      auditClass: "read",
    },
    inputSchema: z.object({}),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_balances",
      title: "Balances",
      description:
        "Read-only, needs credentials. Non-zero balances with free, locked, and total amounts.",
      capability: "READ",
      riskClass: "read",
      environmentRequirement: "any",
      authRequirement: "credentials",
      destructive: false,
      idempotencyClass: "none",
      auditClass: "read",
    },
    inputSchema: z.object({}),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_capabilities",
      title: "Capabilities",
      description:
        "Read-only. Which capabilities this server unlocks from its configuration. Booleans only, never secrets. For the per-gate breakdown see the liveGate object in the response; for policy detail use indodax_system_capabilities.",
      capability: "SYSTEM",
      riskClass: "read",
      environmentRequirement: "any",
      authRequirement: "none",
      destructive: false,
      idempotencyClass: "none",
      auditClass: "read",
    },
    inputSchema: z.object({}),
  });

  handlers.tools.set("indodax_account", async () => {
    try {
      if (!app.accountClient) throw credentialError();
      const account = await app.accountClient.getAccount();
      app.accountSyncedAt = Date.now();
      const views = toBalanceViews(account);
      return ok({
        ...account,
        balances: views,
        balanceCount: views.length,
        nonZeroBalances: views.filter((view) => view.total !== "0").length,
        syncedAt: new Date(app.accountSyncedAt).toISOString(),
        summary: `account ${account.uid ?? "unknown"} with ${views.length} balance row(s), trading ${account.canTrade ? "enabled" : "disabled"}`,
      });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_balances", async () => {
    try {
      if (!app.accountClient) throw credentialError();
      const account = await app.accountClient.getAccount();
      app.accountSyncedAt = Date.now();
      const views = toBalanceViews(account).filter((view) => view.total !== "0");
      return ok({
        count: views.length,
        balances: views,
        assets: views.map((view) => view.asset),
        syncedAt: new Date(app.accountSyncedAt).toISOString(),
        summary: `${views.length} non-zero balance(s)`,
      });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_capabilities", async () => {
    const liveAllowed =
      app.env.APP_ENV === "live" &&
      app.env.TRADE_ENABLED === true &&
      app.policy.allowedModes.includes("live") &&
      app.policy.allowedCapabilities.includes("TRADE") &&
      app.accountClient !== null;
    return ok({
      "market.read": true,
      "account.read": app.accountClient !== null,
      "trade.place": liveAllowed,
      "trade.cancel": liveAllowed,
      "funding.withdraw": false,
      "paper.*": true,
      mode: app.env.APP_ENV,
      policy: {
        allowedModes: app.policy.allowedModes,
        allowedCapabilities: app.policy.allowedCapabilities,
        killSwitch: app.policy.killSwitch,
        circuitBreaker: app.policy.circuitBreaker,
      },
      liveGate: {
        satisfied: liveAllowed,
        needsAppEnvLive: app.env.APP_ENV === "live",
        needsTradeEnabled: app.env.TRADE_ENABLED === true,
        needsCredentials: app.accountClient !== null,
        needsAcknowledged: "per live call (acknowledged: true)",
        needsRiskAllow: "per live call (risk ALLOW)",
      },
      summary: liveAllowed
        ? "live trading gated open (still needs per-call ack + risk ALLOW)"
        : "live trading closed; paper simulation open",
    });
  });
}

function credentialError(): Error {
  return AuthenticationError("no API credentials configured for this private tool");
}
