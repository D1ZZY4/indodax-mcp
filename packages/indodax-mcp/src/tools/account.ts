import { z } from "zod";
import { AuthenticationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { toBalanceViews } from "@indodax-mcp/indodax-account";
import { fail, ok } from "../respond.js";
import type { AppServices } from "../composition.js";

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
        "Read-only. Which capabilities this server unlocks from its configuration. Booleans only, never secrets.",
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
      return ok(account);
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_balances", async () => {
    try {
      if (!app.accountClient) throw credentialError();
      const account = await app.accountClient.getAccount();
      app.accountSyncedAt = Date.now();
      return ok(toBalanceViews(account).filter((view) => view.total !== "0"));
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_capabilities", async () => {
    const liveAllowed =
      app.env.APP_ENV === "live" &&
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
    });
  });
}

function credentialError(): Error {
  return AuthenticationError("no API credentials configured for this private tool");
}
