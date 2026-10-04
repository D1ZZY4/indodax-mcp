import { z } from "zod";
import { AuthenticationError, AuthorizationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { requestDeadmanCountdown } from "@indodax-mcp/indodax-deadman";
import { fail, ok, parseArgs } from "../respond.js";
import type { AppServices } from "../composition.js";

export function registerDeadmanTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool({
    metadata: {
      name: "indodax_deadman_arm",
      title: "Arm Deadman",
      description:
        "Mutating safety state. Arm the Deadman countdown for pairs. Paper only simulates. Args: pairs, countdownMs.",
      capability: "TRADE",
      riskClass: "mutation",
      environmentRequirement: "paper",
      authRequirement: "none",
      destructive: false,
      idempotencyClass: "none",
      auditClass: "mutation",
    },
    inputSchema: z.object({
      pairs: z.array(z.string().min(1)).min(1),
      countdownMs: z.number().positive(),
    }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_deadman_status",
      title: "Deadman status",
      description: "Read-only. Deadman state, pairs, and failure count.",
      capability: "READ",
      riskClass: "read",
      environmentRequirement: "any",
      authRequirement: "none",
      destructive: false,
      idempotencyClass: "none",
      auditClass: "read",
    },
    inputSchema: z.object({}),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_deadman_disarm",
      title: "Disarm Deadman",
      description:
        "Mutating global safety state. Disarm the Deadman countdown after acknowledged:true. Without heartbeat protection trading loses its safety net.",
      capability: "TRADE",
      riskClass: "mutation",
      environmentRequirement: "paper",
      authRequirement: "none",
      destructive: false,
      idempotencyClass: "none",
      auditClass: "mutation",
    },
    inputSchema: z.object({ acknowledged: z.boolean() }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_deadman_heartbeat",
      title: "Deadman heartbeat",
      description:
        "Live exchange safety. Refresh the exchange-side Deadman countdown so open orders survive another window; a missed window cancels them. Needs acknowledged true, APP_ENV=live, TRADE_ENABLED=true, and credentials. Countdown 0 stops the exchange timer. Args: countdownMs, optional pairs defaulting to armed pairs.",
      capability: "TRADE",
      riskClass: "mutation",
      environmentRequirement: "live",
      authRequirement: "credentials",
      destructive: false,
      idempotencyClass: "none",
      auditClass: "mutation",
    },
    inputSchema: z.object({
      countdownMs: z.number().nonnegative(),
      pairs: z.array(z.string().min(1)).min(1).optional(),
      acknowledged: z.boolean().optional(),
    }),
  });

  handlers.tools.set("indodax_deadman_arm", async (raw) => {
    try {
      const args = parseArgs(
        z.object({ pairs: z.array(z.string().min(1)).min(1), countdownMs: z.number().positive() }),
        raw,
      );
      const status = app.deadman.arm(args.pairs, args.countdownMs);
      app.health.set("deadman", { status: "healthy", detail: `armed ${status.pairs.join(",")}` });
      return ok(status);
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_deadman_status", async () => ok(app.deadman.snapshot()));
  handlers.tools.set("indodax_deadman_disarm", async (raw) => {
    try {
      const args = parseArgs(z.object({ acknowledged: z.boolean() }), raw);
      if (args.acknowledged !== true) {
        throw AuthorizationError("disarming deadman needs acknowledged true");
      }
      const status = app.deadman.disarm();
      app.health.set("deadman", { status: "healthy", detail: "disarmed" });
      return ok(status);
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_deadman_heartbeat", async (raw) => {
    try {
      const args = parseArgs(
        z.object({
          countdownMs: z.number().nonnegative(),
          pairs: z.array(z.string().min(1)).min(1).optional(),
          acknowledged: z.boolean().optional(),
        }),
        raw,
      );
      if (args.acknowledged !== true) {
        throw AuthorizationError("exchange heartbeat needs acknowledged true");
      }
      if (app.env.APP_ENV !== "live" || app.env.TRADE_ENABLED !== true) {
        throw AuthorizationError("exchange heartbeat needs APP_ENV=live and TRADE_ENABLED=true");
      }
      if (!app.env.INDODAX_API_KEY || !app.env.INDODAX_API_SECRET) {
        throw AuthenticationError("exchange heartbeat needs API credentials");
      }
      const pairs = args.pairs ?? app.deadman.snapshot().pairs;
      await app.limiter.acquire("v2-rest");
      await requestDeadmanCountdown(app.env.INDODAX_API_KEY, app.env.INDODAX_API_SECRET, {
        pairs,
        countdownMs: args.countdownMs,
      });
      const status = app.deadman.recordRefreshSuccess();
      app.health.set("deadman", { status: "healthy", detail: "heartbeat ok" });
      return ok({ pairs, countdownMs: args.countdownMs, state: status.state });
    } catch (error) {
      if (app.deadman.snapshot().state !== "DISARMED") app.deadman.recordRefreshFailure();
      return fail(error);
    }
  });
}
