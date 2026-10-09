import { z } from "zod";
import { AuthenticationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { toBalanceViews } from "@indodax-mcp/indodax-account";
import { fail, ok, parseArgs } from "@indodax-mcp/mcp-app/respond";
import { defineTool } from "@indodax-mcp/mcp-app/tools/define";
import type { AppServices } from "@indodax-mcp/mcp-app/composition";

const AUTH_READ = {
  capability: "READ" as const,
  riskClass: "read" as const,
  environmentRequirement: "any" as const,
  authRequirement: "credentials" as const,
  destructive: false,
  idempotencyClass: "none" as const,
  auditClass: "read" as const,
};

const SYSTEM_READ = {
  ...AUTH_READ,
  capability: "SYSTEM" as const,
  authRequirement: "none" as const,
};

/**
 * Account reads.
 *
 * Two tools instead of four. `indodax_account` absorbed `indodax_balances`
 * through a `zeroBalances` flag, and `indodax_capabilities` absorbed
 * `indodax_auth_status` through a `credentialsSource` block. Both absorbed
 * surfaces were strict subsets: balances were the same `toBalanceViews` call
 * over the same `getAccount()` read, and auth status was exactly
 * `credentialsConfigured` plus `mode`, which capabilities already reported.
 */
const account = defineTool(
  {
    name: "indodax_account",
    title: "Account information",
    description:
      "Read-only, needs credentials. Account identity, permissions, and balances, with free, locked, and total per asset. Fails cleanly without credentials. Replaces the former indodax_balances: pass zeroBalances false to keep only non-zero rows. assets lists the returned assets and nonZeroBalances counts them either way.",
    ...AUTH_READ,
  },
  { zeroBalances: z.boolean().optional().describe("Set false to keep only non-zero rows") },
);

const capabilities = defineTool(
  {
    name: "indodax_capabilities",
    title: "Capabilities",
    description:
      "Read-only. Which capabilities this server unlocks from its configuration, and where the credentials came from. Booleans and origin names only, never secret values. Replaces the former indodax_auth_status: its credentialsConfigured and mode are now credentialsSource.credentialsPresent and the top-level mode. See liveGate for the per-requirement checklist, and indodax_system_capabilities for the policy view.",
    ...SYSTEM_READ,
  },
  {},
);

export function registerAccountTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool(account);
  registry.registerTool(capabilities);

  handlers.tools.set("indodax_account", async (raw) => {
    try {
      const args = parseArgs(account.inputSchema, raw);
      if (!app.accountClient) throw credentialError();
      const info = await app.accountClient.getAccount();
      app.accountSyncedAt = Date.now();
      const views = toBalanceViews(info);
      const rows = args.zeroBalances === false ? views.filter((view) => view.total !== "0") : views;
      return ok({
        ...info,
        balances: rows,
        balanceCount: rows.length,
        nonZeroBalances: views.filter((view) => view.total !== "0").length,
        assets: rows.map((view) => view.asset),
        syncedAt: new Date(app.accountSyncedAt).toISOString(),
        summary: `account ${info.uid ?? "unknown"} with ${rows.length} balance row(s), trading ${info.canTrade ? "enabled" : "disabled"}`,
        note:
          args.zeroBalances === false
            ? "zeroBalances false applied, so only non-zero rows are listed."
            : "Balances include zero rows. Pass zeroBalances false to keep only non-zero rows.",
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
    // Provenance of the credentials, never their values. This is what the
    // former indodax_auth_status answered, folded in so the whole capability
    // story is a single read.
    return ok({
      "market.read": true,
      "account.read": app.accountClient !== null,
      "trade.place": liveAllowed,
      "trade.cancel": liveAllowed,
      "funding.withdraw": false,
      "paper.*": true,
      mode: app.env.APP_ENV,
      credentialsSource: {
        credentialsPresent: app.accountClient !== null,
        apiKey: app.configDiagnostic.credentials.INDODAX_API_KEY,
        apiSecret: app.configDiagnostic.credentials.INDODAX_API_SECRET,
        repoEnvFileFound: app.configDiagnostic.repoEnvFileFound,
        note: "origin names only, never values",
      },
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
