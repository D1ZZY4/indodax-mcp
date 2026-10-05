import { z } from "zod";
import { AuthorizationError, ValidationError } from "@indodax-mcp/errors";
import { oneShotPairSnapshot } from "@indodax-mcp/indodax-websocket";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { fail, ok, parseArgs } from "../respond.js";
import { pairArg } from "../schemas.js";
import { defineTool } from "./define.js";
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

const wsStatus = defineTool(
  {
    name: "indodax_ws_status",
    title: "WebSocket status",
    description: "Read-only. Market and private socket connection states plus subscriptions.",
    ...SYSTEM,
  },
  {},
);

const wsTicker = defineTool(
  {
    name: "indodax_ws_ticker",
    title: "WebSocket ticker",
    description:
      "Read-only. One-shot live market summary snapshot over WebSocket with the requested pair row when present, 15s timeout. Returns an explicit error naming the pair when it is missing from the snapshot instead of unrelated rows. Args: pair default btc_idr.",
    ...SYSTEM,
  },
  { pair: pairArg.optional() },
);

export function registerSystemTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  const defs: { name: string; description: string }[] = [
    { name: "indodax_health", description: "Read-only. Service health rollup with checks." },
    {
      name: "indodax_readiness",
      description:
        "Read-only. Whether the server can serve traffic: ready only when overall health is healthy, with degradedReasons otherwise.",
    },
    { name: "indodax_version", description: "Read-only. Server name, version, and mode." },
    {
      name: "indodax_system_capabilities",
      description:
        "Read-only. Capability matrix with kill switch and modes. Policy-level view; for the live gate checklist per boolean use indodax_capabilities.",
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
  registry.registerTool(wsStatus);
  registry.registerTool(wsTicker);

  handlers.tools.set("indodax_health", async () => {
    const snapshot = app.health.snapshot();
    const wiring: Record<string, { wired: boolean; action: string }> = {
      database: {
        wired: false,
        action: "set DATABASE_URL to mirror paper/audit/alerts/stops/deadman",
      },
      exchangeRest: {
        wired: false,
        action: "public market reads probe on demand; no static check",
      },
      exchangeWs: {
        wired: false,
        action: "sockets connect on demand via indodax_ws_ticker/reconnect",
      },
      mcpTransport: {
        wired: true,
        action: "registry built; transports stdio + Streamable HTTP share it",
      },
      scheduler: { wired: true, action: "jobs listed in scheduler; failures in schedulerFailures" },
      queue: { wired: false, action: "no external queue; scheduler runs in-process" },
      deadman: { wired: true, action: "see indodax_deadman_status for ARMED/STALE/EXPIRED" },
      configuration: { wired: true, action: "environment parsed; see indodax_config_status" },
      runtime: { wired: true, action: "server composed; see indodax_runtime_status" },
    };
    const components = Object.fromEntries(
      Object.entries(snapshot).map(([name, component]) => {
        const meta = wiring[name] ?? { wired: false, action: "see runbook" };
        const base =
          component.status === "unknown" && !("detail" in component)
            ? { ...component, detail: "check not wired, not a failure" }
            : component;
        return [
          name,
          {
            ...base,
            wired: meta.wired,
            action: meta.action,
            checkedAt: new Date().toISOString(),
          },
        ];
      }),
    );
    const overall = app.health.overall();
    return ok({
      status: overall,
      components,
      healthy: Object.values(snapshot).filter((c) => c.status === "healthy").length,
      total: Object.keys(snapshot).length,
      checkedAt: new Date().toISOString(),
      summary: `overall ${overall} with ${Object.values(snapshot).filter((c) => c.status === "healthy").length}/${Object.keys(snapshot).length} healthy components`,
      note: "Unwired checks report complete detail with wiring and next action instead of a bare code.",
    });
  });
  handlers.tools.set("indodax_readiness", async () => {
    const status = app.health.overall();
    const snapshot = app.health.snapshot();
    const degraded = Object.entries(snapshot).filter(
      ([, component]) => component.status !== "healthy",
    );
    return ok({
      ready: status === "healthy",
      status,
      degradedCount: degraded.length,
      degradedReasons: degraded.map(([name, component]) => `${name}:${component.status}`),
      degradedDetail: degraded.map(([name, component]) => ({
        component: name,
        status: component.status,
        detail:
          "detail" in component ? component.detail : "see indodax_health for wiring and action",
        action: "see indodax_health for wiring and next step",
      })),
      checkedAt: new Date().toISOString(),
      summary:
        status === "healthy"
          ? "ready to serve traffic"
          : `not ready: ${degraded.length} non-healthy component(s) listed with detail`,
    });
  });
  handlers.tools.set("indodax_version", async () =>
    ok({
      server: "indodax-mcp",
      version: "1.0.0",
      mode: app.env.APP_ENV,
      protocol: "2025-11-25",
      transports: ["stdio", "streamable-http"],
      checkedAt: new Date().toISOString(),
      summary: `indodax-mcp 1.0.0 in ${app.env.APP_ENV} mode over stdio + Streamable HTTP`,
    }),
  );
  handlers.tools.set("indodax_system_capabilities", async () =>
    ok({
      "market.read": "allowed",
      "account.read": app.accountClient ? "allowed with credentials" : "needs credentials",
      "trade.place": "controlled via risk engine",
      "trade.cancel": "controlled via risk engine",
      "funding.withdraw": "disabled by default",
      killSwitch: app.policy.killSwitch,
      circuitBreaker: app.policy.circuitBreaker,
      allowedModes: app.policy.allowedModes,
      allowedCapabilities: app.policy.allowedCapabilities,
      liveGate: {
        appEnvLive: app.env.APP_ENV === "live",
        tradeEnabled: app.env.TRADE_ENABLED === true,
        credentials: app.accountClient !== null,
        policyAllowsLive: app.policy.allowedModes.includes("live"),
      },
      summary: `paper ${app.policy.allowedModes.includes("paper") ? "enabled" : "disabled"}, live ${app.policy.allowedModes.includes("live") ? "gated" : "disabled"}, withdraw disabled`,
    }),
  );
  handlers.tools.set("indodax_config_status", async () => {
    const configured = app.accountClient !== null;
    const diagnostic = app.configDiagnostic;
    const keySource = diagnostic.credentials.INDODAX_API_KEY;
    const secretSource = diagnostic.credentials.INDODAX_API_SECRET;
    // The actionable case: the operator believes credentials are configured but
    // this process never received them. Name the channel instead of just
    // reporting "absent".
    const remedy = configured
      ? `credentials reached this process from ${keySource}`
      : keySource === "absent" && secretSource === "absent"
        ? "this process received no INDODAX_API_KEY or INDODAX_API_SECRET; export them in the environment of the process that starts this server, or add a repository .env beside the workspace"
        : `partial credentials: INDODAX_API_KEY from ${keySource}, INDODAX_API_SECRET from ${secretSource}; both are required`;
    return ok({
      credentialsConfigured: configured,
      mode: app.env.APP_ENV,
      tradeEnabled: app.env.TRADE_ENABLED ?? false,
      withdrawEnabled: false,
      mcpPort: app.env.MCP_PORT ?? 8000,
      rateLimitRps: app.env.INDODAX_RATE_LIMIT ?? null,
      stopAutopollMs: app.env.STOP_AUTOPOLL_MS ?? null,
      alertAutopollMs: app.env.ALERT_AUTOPOLL_MS ?? null,
      database: app.env.DATABASE_URL !== undefined ? "configured" : "absent",
      configSource: {
        credentials: diagnostic.credentials,
        repoEnvFileFound: diagnostic.repoEnvFileFound,
        otherVariablesPresent: diagnostic.otherVariablesPresent,
        note: "origin names only, never values; a remote MCP client cannot inject environment into a server it does not start",
      },
      summary: `mode ${app.env.APP_ENV}, credentials ${
        configured ? `present from ${keySource}` : "absent"
      }, withdraw always disabled`,
      remedy,
    });
  });
  handlers.tools.set("indodax_runtime_status", async () =>
    ok({
      scheduler: app.scheduler.running,
      schedulerFailures: app.scheduler.failures.length,
      marketSocket: app.marketSocket.connectionState,
      privateChannel: app.privateChannel.connectionState,
      metrics: app.metrics.snapshot(),
      deadman: app.deadman.snapshot(),
      persistence: {
        database: app.env.DATABASE_URL !== undefined ? "configured" : "absent",
        mirrors: ["paper", "audit", "alerts", "stops", "deadman"],
        note:
          app.env.DATABASE_URL !== undefined
            ? "mutations mirror to Postgres when reachable; restarts reload the latest snapshots"
            : "memory-only: a restart resets paper, audit, alerts, stops, and deadman state",
      },
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
      mode: "on-demand: sockets connect only when a tool needs them; DISCONNECTED is the resting state, not a failure",
      market: {
        state: app.marketSocket.connectionState,
        subscriptions: app.marketSocket.listSubscriptions(),
      },
      private: {
        state: app.privateChannel.connectionState,
        channel: app.privateChannel.channel,
      },
    }),
  );
  handlers.tools.set("indodax_ws_ticker", async (raw) => {
    try {
      const args = parseArgs(wsTicker.inputSchema, raw);
      const token = app.env.INDODAX_WS_TOKEN;
      const event = await oneShotPairSnapshot(args.pair ?? "btc_idr", token);
      const row = (event.data as { row?: unknown }).row ?? null;
      if (row === null) {
        throw ValidationError(
          `pair ${args.pair ?? "btc_idr"} missing from the live summary snapshot; use indodax_ticker (REST) for this pair`,
        );
      }
      return ok(event);
    } catch (error) {
      return fail(error);
    }
  });
}
