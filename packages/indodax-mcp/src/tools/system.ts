import { z } from "zod";
import { AuthorizationError, ValidationError } from "@indodax-mcp/errors";
import { oneShotPairSnapshot } from "@indodax-mcp/indodax-websocket";
import { maskPrivateChannel } from "@indodax-mcp/indodax-websocket/private-channel";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { fail, ok, parseArgs } from "@indodax-mcp/indodax-mcp/respond";
import { pairArg } from "@indodax-mcp/indodax-mcp/schemas";
import { defineTool } from "@indodax-mcp/indodax-mcp/tools/define";
import { refreshPersistenceState } from "@indodax-mcp/indodax-mcp/persistence-state";
import { SERVER_NAME, SERVER_VERSION } from "@indodax-mcp/indodax-mcp/version";
import type { AppServices } from "@indodax-mcp/indodax-mcp/composition";

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
        wired: true,
        action:
          "set DATABASE_URL to mirror paper/audit/alerts/stops/deadman; " +
          "config_status reports whether the connection is actually reachable",
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
      server: SERVER_NAME,
      version: SERVER_VERSION,
      mode: app.env.APP_ENV,
      protocol: "2025-11-25",
      transports: ["stdio", "streamable-http"],
      checkedAt: new Date().toISOString(),
      summary: `${SERVER_NAME} ${SERVER_VERSION} in ${app.env.APP_ENV} mode over stdio + Streamable HTTP`,
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
    // Re-evaluated per read rather than captured at boot: the pool can keep
    // writing into a server that has gone away, so the only honest signal is the
    // most recent write outcome.
    const persistence = refreshPersistenceState();
    const database =
      persistence.state === "connected"
        ? "connected"
        : persistence.state === "failed"
          ? "configured_unreachable"
          : "absent";
    return ok({
      credentialsConfigured: configured,
      mode: app.env.APP_ENV,
      tradeEnabled: app.env.TRADE_ENABLED ?? false,
      withdrawEnabled: false,
      mcpPort: app.env.MCP_PORT ?? 8000,
      mcpHost: app.env.MCP_HOST ?? "127.0.0.1",
      rateLimitRps: app.env.INDODAX_RATE_LIMIT ?? null,
      stopAutopollMs: app.env.STOP_AUTOPOLL_MS ?? null,
      alertAutopollMs: app.env.ALERT_AUTOPOLL_MS ?? null,
      /**
       * Reachability, not presence. `configured` used to mean only that the
       * variable existed, which stayed green while every mirror write failed
       * and a restart silently lost stops, alerts, and the deadman state.
       */
      database,
      durability: {
        state: persistence.state,
        mirrors: persistence.mirrors,
        since: persistence.since,
        lastError: persistence.lastError,
        degraded: persistence.degraded,
        note: persistence.degraded
          ? "the database mirror is configured but not reachable, so a restart cannot restore this state"
          : "state is mirrored and restored on boot",
      },
      configSource: {
        credentials: diagnostic.credentials,
        repoEnvFileFound: diagnostic.repoEnvFileFound,
        otherVariablesPresent: diagnostic.otherVariablesPresent,
        note: "origin names only, never values; a remote MCP client cannot inject environment into a server it does not start",
      },
      summary: `mode ${app.env.APP_ENV}, credentials ${
        configured ? `present from ${keySource}` : "absent"
      }, database ${database}, withdraw always disabled`,
      remedy: persistence.degraded
        ? `database unreachable since ${persistence.since}${
            persistence.lastError === null ? "" : ` (${persistence.lastError})`
          }; start it before relying on ${persistence.mirrors.join(",")} across a restart`
        : remedy,
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
        // Masked hash: status pages are logged on every poll, and only the
        // socket manager needs the full channel id.
        channel: maskPrivateChannel(app.privateChannel.channel),
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
