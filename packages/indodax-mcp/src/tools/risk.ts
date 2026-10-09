import { z } from "zod";
import { ValidationError } from "@d1zzy4-jethools/errors";
import type { Registry } from "@d1zzy4-jethools/mcp-registry";
import type { ServerHandlers } from "@d1zzy4-jethools/mcp-core";
import { decimalOrNull, parseSymbolFlexible } from "@d1zzy4-jethools/core";
import { fail, ok, parseArgs } from "@d1zzy4-jethools/mcp-app/respond";
import { canonicalPair, pairArg, priceArg } from "@d1zzy4-jethools/mcp-app/schemas";
import { defineTool } from "@d1zzy4-jethools/mcp-app/tools/define";
import { assessBudgetSize, assessStopRisk } from "@d1zzy4-jethools/mcp-app/risk-budget";
import { checkPaperConsistency } from "@d1zzy4-jethools/mcp-app/paper-consistency";
import { resolveRiskContext } from "@d1zzy4-jethools/mcp-app/risk-context";
import type { AppServices } from "@d1zzy4-jethools/mcp-app/composition";

const SYSTEM_READ = {
  capability: "SYSTEM" as const,
  riskClass: "read" as const,
  environmentRequirement: "any" as const,
  authRequirement: "none" as const,
  destructive: false,
  idempotencyClass: "none" as const,
  auditClass: "read" as const,
};

const riskLimits = defineTool(
  {
    name: "indodax_risk_limits",
    title: "Risk limits",
    description:
      "Read-only. Deterministic risk limits and thresholds. Notionals in quote-asset units (IDR for _idr pairs), durations in ms. Takes no arguments.",
    ...SYSTEM_READ,
  },
  {},
);

const riskState = defineTool(
  {
    name: "indodax_risk_state",
    title: "Risk state",
    description:
      "Read-only. Kill switch, circuit breaker, allowed modes, and Deadman state. Takes no arguments.",
    ...SYSTEM_READ,
  },
  {},
);

const riskEvaluate = defineTool(
  {
    name: "indodax_risk_evaluate",
    title: "Evaluate order risk",
    description:
      "No side effects. Run a hypothetical order through risk. Returns ALLOW, DENY, REVIEW, or HALT with reason codes. Nothing is placed. Accepts optional riskBudget in quote units plus optional stopPrice: the response carries notionalMultiple for sizing and, with a stop, the real stop-distance riskMultiple, which warns above 1x.",
    ...SYSTEM_READ,
    // TRADE after the spread: SYSTEM_READ defaults to SYSTEM, and evaluating an
    // order is a trade-path capability even though it has no side effects.
    capability: "TRADE",
  },
  {
    pair: pairArg,
    side: z.enum(["BUY", "SELL"]),
    quantity: z.number().positive(),
    price: z.number().positive(),
    mode: z.enum(["paper", "live"]).optional(),
    riskBudget: z.number().positive().optional(),
    stopPrice: priceArg.optional(),
  },
);

export function registerRiskTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool(riskLimits);
  registry.registerTool(riskState);
  registry.registerTool(riskEvaluate);

  handlers.tools.set("indodax_risk_limits", async () => {
    const limits = Object.fromEntries(
      Object.entries(app.limits).map(([key, value]) => [key, String(value)]),
    );
    return ok({
      ...limits,
      quoteAsset: "notionals in quote-asset units (IDR for _idr pairs), durations in ms",
      summary: `min ${app.limits.minOrderNotional.toString()} to max ${app.limits.maxOrderNotional.toString()} per order`,
    });
  });
  handlers.tools.set("indodax_risk_state", async () => {
    const deadman = app.deadman.snapshot();
    // Derived from the live ledger rather than read from cached application
    // state, so this read-only query can never be the thing that decides
    // whether trading is halted.
    const reconciliationHalted = checkPaperConsistency(app).state === "MISMATCH";
    // A stale or expired deadman is a live-trading halt enforced by the engine,
    // so it belongs in the halt verdict. Leaving it out reported halted=false
    // while live placement was in fact refused with DEADMAN_UNKNOWN.
    const deadmanHalted = deadman.state === "STALE" || deadman.state === "EXPIRED";
    const haltReason = app.policy.killSwitch
      ? "killSwitch"
      : app.policy.circuitBreaker
        ? "circuitBreaker"
        : reconciliationHalted
          ? "reconciliationHalted"
          : deadmanHalted
            ? `deadman${deadman.state}`
            : null;
    return ok({
      killSwitch: app.policy.killSwitch,
      circuitBreaker: app.policy.circuitBreaker,
      allowedModes: app.policy.allowedModes,
      allowedCapabilities: app.policy.allowedCapabilities,
      deadman,
      halted: haltReason !== null,
      haltReason,
      reconciliationHalted,
      // Stated separately because DISARMED is an explicit opt-out that never
      // blocks, while STALE and EXPIRED halt live trading.
      deadmanHalted,
      summary:
        haltReason !== null
          ? `trading path closed by halt condition (${haltReason})`
          : `trading open for ${app.policy.allowedModes.join(", ")}`,
    });
  });
  handlers.tools.set("indodax_risk_evaluate", async (raw) => {
    try {
      const args = parseArgs(riskEvaluate.inputSchema, raw);
      const symbol = parseSymbolFlexible(args.pair);
      if (!symbol) throw ValidationError(`invalid pair: ${args.pair}`);
      const price = decimalOrNull(args.price);
      const quantity = decimalOrNull(args.quantity);
      if (!price || !quantity) throw ValidationError("price and quantity must be positive numbers");
      const mode = args.mode ?? "paper";
      const decision = app.risk.evaluate(
        { notional: price.mul(quantity), quantity, price, isMarket: false, symbol: args.pair },
        await resolveRiskContext(app, {
          mode,
          capability: mode === "paper" ? "PAPER" : "TRADE",
          pair: args.pair,
        }),
      );
      const sizing = assessBudgetSize(price.mul(quantity), args.riskBudget);
      const stop = assessStopRisk({
        price,
        stopPrice: args.stopPrice,
        quantity,
        budget: args.riskBudget,
      });
      return ok(
        {
          pair: canonicalPair(args.pair),
          side: args.side,
          outcome: decision.outcome,
          reasons: decision.reasons,
          message: decision.message,
          notional: price.mul(quantity).toString(),
          price: price.toString(),
          quantity: quantity.toString(),
          mode,
          ...sizing,
          riskAmount: stop.riskAmount,
          riskMultiple: stop.riskMultiple,
          riskWarning: stop.riskWarning,
          riskNote: stop.riskNote,
          minimumQty: app.limits.minOrderNotional.div(price).toString(),
          currentNotional: price.mul(quantity).toString(),
          minimumNotional: app.limits.minOrderNotional.toString(),
          limits: {
            minOrderNotional: app.limits.minOrderNotional.toString(),
            maxOrderNotional: app.limits.maxOrderNotional.toString(),
          },
          summary: `${decision.outcome} for ${args.side} ${String(args.quantity)} ${canonicalPair(args.pair)} at ${String(args.price)}`,
        },
        stop.riskWarning === null ? [] : [stop.riskWarning],
      );
    } catch (error) {
      return fail(error);
    }
  });
}
