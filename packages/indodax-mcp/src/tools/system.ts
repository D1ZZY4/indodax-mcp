import { z } from "zod";
import { AuthorizationError } from "@indodax-mcp/errors";
import { oneShotSnapshot } from "@indodax-mcp/indodax-websocket";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { fail, ok, pairArg, parseArgs } from "../respond.js";
import type { AppServices } from "../composition.js";

const SYSTEM = {
  capability: "SYSTEM" as const,
  riskClass: "read" as const,
  environmentRequirement: "any" as const,
  authRequirement: "none" as const,
  destructive: false,
  idempotencyClass: "none" as const,
  auditClass: "read" as const,
};

export function registerSystemTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  const defs: { name: string; description: string }[] = [
    { name: "indodax_health", description: "Read-only. Service health rollup with checks." },
    { name: "indodax_readiness", description: "Read-only. Whether the server can serve traffic." },
    { name: "indodax_version", description: "Read-only. Server name, version, and mode." },
    {
      name: "indodax_system_capabilities",
      description: "Read-only. Capability matrix with kill switch and modes.",
    },
    {
      name: "indodax_config_status",
      description: "Read-only. Credential presence booleans and mode. Never secrets.",
    },
    {
      name: "indodax_runtime_status",
      description: "Read-only. Scheduler jobs, sockets, metrics counters, deadman state.",
    },
    {
      name: "indodax_auth_status",
      description: "Read-only. Whether API credentials are configured. Booleans only.",
    },
    {
      name: "indodax_funding_withdraw",
      description:
        "Always denied. Withdrawal needs a separate grant this server never holds. Args accepted for shape validation only.",
    },
  ];
  for (const def of defs) {
    registry.registerTool({
      metadata: {
        name: def.name,
        title: def.name,
        description: def.description,
        ...SYSTEM,
      },
      inputSchema:
        def.name === "indodax_funding_withdraw"
          ? z.object({
              currency: z.string().min(1),
              amount: z.number().positive(),
              address: z.string().min(1),
            })
          : z.object({}),
    });
  }
  registry.registerTool({
    metadata: {
      name: "indodax_ws_status",
      title: "WebSocket status",
      description: "Read-only. Market and private socket connection states plus subscriptions.",
      ...SYSTEM,
    },
    inputSchema: z.object({}),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_ws_ticker",
      title: "WebSocket ticker",
      description:
        "Read-only. One-shot live ticker over WebSocket, 10s timeout. Args: pair default btc_idr.",
      ...SYSTEM,
    },
    inputSchema: z.object({ pair: pairArg.optional() }),
  });

  handlers.tools.set("indodax_health", async () =>
    ok({ status: app.health.overall(), components: app.health.snapshot() }),
  );
  handlers.tools.set("indodax_readiness", async () =>
    ok({ ready: app.health.overall() !== "halted", status: app.health.overall() }),
  );
  handlers.tools.set("indodax_version", async () =>
    ok({ server: "indodax-mcp", version: "1.0.0", mode: app.env.APP_ENV }),
  );
  handlers.tools.set("indodax_system_capabilities", async () =>
    ok({
      "market.read": "allowed",
      "account.read": app.accountClient ? "allowed with credentials" : "needs credentials",
      "trade.place": "controlled via risk engine",
      "trade.cancel": "controlled via risk engine",
      "funding.withdraw": "disabled by default",
      killSwitch: app.policy.killSwitch,
      allowedModes: app.policy.allowedModes,
    }),
  );
  handlers.tools.set("indodax_config_status", async () =>
    ok({
      credentialsConfigured: app.accountClient !== null,
      mode: app.env.APP_ENV,
      tradeEnabled: app.env.TRADE_ENABLED ?? false,
      withdrawEnabled: false,
    }),
  );
  handlers.tools.set("indodax_runtime_status", async () =>
    ok({
      scheduler: app.scheduler.running,
      schedulerFailures: app.scheduler.failures.length,
      marketSocket: app.marketSocket.connectionState,
      privateSocket: app.privateSocket.connectionState,
      metrics: app.metrics.snapshot(),
      deadman: app.deadman.snapshot(),
    }),
  );
  handlers.tools.set("indodax_auth_status", async () =>
    ok({ credentialsConfigured: app.accountClient !== null, mode: app.env.APP_ENV }),
  );
  handlers.tools.set("indodax_funding_withdraw", async () =>
    fail(AuthorizationError("funding.withdraw is disabled and needs a separate grant")),
  );
  handlers.tools.set("indodax_ws_status", async () =>
    ok({
      market: {
        state: app.marketSocket.connectionState,
        subscriptions: app.marketSocket.listSubscriptions(),
      },
      private: {
        state: app.privateSocket.connectionState,
        subscriptions: app.privateSocket.listSubscriptions(),
      },
    }),
  );
  handlers.tools.set("indodax_ws_ticker", async (raw) => {
    try {
      const args = parseArgs(z.object({ pair: pairArg.optional() }), raw);
      const token = app.env.INDODAX_WS_TOKEN;
      const event = await oneShotSnapshot(args.pair ?? "btc_idr", token);
      return ok(event);
    } catch (error) {
      return fail(error);
    }
  });
}
