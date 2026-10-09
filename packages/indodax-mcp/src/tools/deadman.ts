import { z } from "zod";
import { AuthenticationError, AuthorizationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { requestDeadmanCountdown } from "@indodax-mcp/indodax-deadman";
import { fail, ok, parseArgs } from "@indodax-mcp/mcp-app/respond";
import { defineTool } from "@indodax-mcp/mcp-app/tools/define";
import type { AppServices } from "@indodax-mcp/mcp-app/composition";

/**
 * Exchange-side countdown availability, tracked separately from the local
 * switch so an unreachable exchange is visible instead of silently turning
 * protection into a no-op.
 */
interface ExchangeState {
  available: boolean;
  lastError: string | null;
  observedAt: string | null;
}

let exchange: ExchangeState = { available: true, lastError: null, observedAt: null };

function noteExchangeReachable(): void {
  exchange = { available: true, lastError: null, observedAt: new Date().toISOString() };
}

function noteExchangeUnreachable(message: string): void {
  exchange = {
    available: false,
    lastError: message.slice(0, 200),
    observedAt: new Date().toISOString(),
  };
}

function exchangeState(): ExchangeState {
  return { ...exchange };
}

/** Test seam: an availability observation must not leak between cases. */
export function resetExchangeState(): void {
  exchange = { available: true, lastError: null, observedAt: null };
}

/**
 * Whether the exchange refused the countdown endpoint outright.
 *
 * Covers the denial reasons the exchange returns for a key that lacks access,
 * including the IP allowlist rejection, since neither can be resolved by
 * retrying and both leave the countdown permanently unreachable.
 */
function isExchangeAccessRefused(message: string): boolean {
  return /access denied|unauthori[sz]ed ip|forbidden|not authorized|permission denied/i.test(
    message,
  );
}

const MUTATION = {
  riskClass: "mutation" as const,
  authRequirement: "none" as const,
  destructive: false,
  idempotencyClass: "none" as const,
  auditClass: "mutation" as const,
};

const deadmanArm = defineTool(
  {
    name: "indodax_deadman_arm",
    title: "Arm Deadman",
    description:
      "Mutating safety state. Arm the Deadman countdown for pairs. Paper only simulates. Args: pairs, countdownMs.",
    capability: "TRADE",
    environmentRequirement: "paper",
    ...MUTATION,
  },
  { pairs: z.array(z.string().min(1)).min(1), countdownMs: z.number().positive() },
);

const deadmanStatus = defineTool(
  {
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
  {},
);

const deadmanDisarm = defineTool(
  {
    name: "indodax_deadman_disarm",
    title: "Disarm Deadman",
    description:
      "Mutating global safety state. Disarm the Deadman countdown after acknowledged:true. Without heartbeat protection trading loses its safety net.",
    capability: "TRADE",
    environmentRequirement: "paper",
    ...MUTATION,
  },
  { acknowledged: z.boolean() },
);

const deadmanHeartbeat = defineTool(
  {
    name: "indodax_deadman_heartbeat",
    title: "Deadman heartbeat",
    description:
      "Live exchange safety. Refresh the exchange-side Deadman countdown so open orders survive another window; a missed window cancels them. Needs acknowledged true, APP_ENV=live, TRADE_ENABLED=true, and credentials. Countdown 0 stops the exchange timer. Args: countdownMs, optional pairs defaulting to armed pairs.",
    capability: "TRADE",
    environmentRequirement: "live",
    ...MUTATION,
    authRequirement: "credentials",
  },
  {
    countdownMs: z.number().nonnegative(),
    pairs: z.array(z.string().min(1)).min(1).optional(),
    acknowledged: z.boolean().optional(),
  },
);

export function registerDeadmanTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool(deadmanArm);
  registry.registerTool(deadmanStatus);
  registry.registerTool(deadmanDisarm);
  registry.registerTool(deadmanHeartbeat);

  handlers.tools.set("indodax_deadman_arm", async (raw) => {
    try {
      const args = parseArgs(deadmanArm.inputSchema, raw);
      const status = app.deadman.arm(args.pairs, args.countdownMs);
      app.health.set("deadman", { status: "healthy", detail: `armed ${status.pairs.join(",")}` });
      return ok({
        ...status,
        summary: `deadman ARMED for ${status.pairs.join(", ")} with ${status.countdownHuman} countdown`,
        note: "STALE or EXPIRED halts trading via risk; DISARMED is explicit opt-out.",
      });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_deadman_status", async () => {
    const status = app.deadman.snapshot();
    return ok({
      ...status,
      /**
       * Whether the exchange countdown is actually running. The local switch
       * can read ARMED while the exchange side is unreachable, and that
       * difference is the whole point: an ARMED local switch with no
       * exchange countdown is not protection.
       */
      exchange: exchangeState(),
      summary:
        `deadman ${status.state}${status.pairs.length > 0 ? ` for ${status.pairs.join(", ")}` : ""}` +
        (exchangeState().available === false
          ? "; the exchange countdown endpoint refused this key, so no exchange-side protection is active"
          : ""),
    });
  });
  handlers.tools.set("indodax_deadman_disarm", async (raw) => {
    try {
      const args = parseArgs(deadmanDisarm.inputSchema, raw);
      if (args.acknowledged !== true) {
        const current = app.deadman.snapshot();
        throw AuthorizationError(
          `disarming deadman needs acknowledged true; the switch stays ${current.state}` +
            (current.pairs.length > 0 ? ` for ${current.pairs.join(", ")}` : "") +
            " with heartbeat protection intact. Pass acknowledged true only when removing " +
            "the safety net is intended",
        );
      }
      const status = app.deadman.disarm();
      app.health.set("deadman", { status: "healthy", detail: "disarmed" });
      return ok({
        ...status,
        summary: "deadman DISARMED; heartbeat protection removed",
        note: "Disarming removes safety net globally; hence acknowledged:true.",
      });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_deadman_heartbeat", async (raw) => {
    try {
      const args = parseArgs(deadmanHeartbeat.inputSchema, raw);
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
      noteExchangeReachable();
      app.health.set("deadman", { status: "healthy", detail: "heartbeat ok" });
      return ok({
        pairs,
        countdownMs: args.countdownMs,
        state: status.state,
        lastRefreshAt: status.lastRefreshAt,
        summary: `exchange heartbeat refreshed for ${pairs.join(", ")} with ${String(args.countdownMs)}ms countdown`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      /**
       * A key the exchange refuses cannot refresh, ever. Counting that as a
       * missed heartbeat guarantees expiry and halts trading for a reason no
       * operator can act on from here, so arming protection would become a way
       * to switch trading off. A permission problem is a misconfiguration, not
       * a lapse: it is reported loudly and surfaced in the status and health
       * views instead of advancing the fail-closed counter.
       */
      if (isExchangeAccessRefused(message)) {
        noteExchangeUnreachable(message);
        app.health.set("deadman", {
          status: "degraded",
          detail:
            "exchange countdown endpoint refused this key; local switch unchanged, no exchange protection active",
        });
        return fail(
          AuthorizationError(
            "the exchange refused the deadman countdown endpoint for this API key, so the countdown cannot be refreshed. " +
              "next: grant this key access to the countdown endpoint, or disarm with acknowledged:true. " +
              "the local switch was left unchanged and no exchange-side protection is active",
          ),
        );
      }
      if (app.deadman.snapshot().state !== "DISARMED") app.deadman.recordRefreshFailure();
      return fail(error);
    }
  });
}
