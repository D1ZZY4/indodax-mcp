import { z } from "zod";
import { ValidationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { decimalOrNull, parseSymbolFlexible } from "@indodax-mcp/core";
import { fail, ok, pairArg, parseArgs } from "../respond.js";
import { resolveRiskContext } from "../risk-context.js";
import type { AppServices } from "../composition.js";

export function registerRiskTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool({
    metadata: {
      name: "indodax_risk_limits",
      title: "Risk limits",
      description: "Read-only. Deterministic risk limits and thresholds. Takes no arguments.",
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
  registry.registerTool({
    metadata: {
      name: "indodax_risk_state",
      title: "Risk state",
      description:
        "Read-only. Kill switch, circuit breaker, allowed modes, and Deadman state. Takes no arguments.",
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
  registry.registerTool({
    metadata: {
      name: "indodax_risk_evaluate",
      title: "Evaluate order risk",
      description:
        "No side effects. Run a hypothetical order through risk. Returns ALLOW, DENY, REVIEW, or HALT with reason codes. Nothing is placed.",
      capability: "TRADE",
      riskClass: "read",
      environmentRequirement: "any",
      authRequirement: "none",
      destructive: false,
      idempotencyClass: "none",
      auditClass: "read",
    },
    inputSchema: z.object({
      pair: pairArg,
      side: z.enum(["BUY", "SELL"]),
      quantity: z.number().positive(),
      price: z.number().positive(),
      mode: z.enum(["paper", "live"]).optional(),
    }),
  });

  handlers.tools.set("indodax_risk_limits", async () => {
    return ok(
      Object.fromEntries(Object.entries(app.limits).map(([key, value]) => [key, String(value)])),
    );
  });
  handlers.tools.set("indodax_risk_state", async () => {
    return ok({
      killSwitch: app.policy.killSwitch,
      circuitBreaker: app.policy.circuitBreaker,
      allowedModes: app.policy.allowedModes,
      allowedCapabilities: app.policy.allowedCapabilities,
      deadman: app.deadman.snapshot(),
    });
  });
  handlers.tools.set("indodax_risk_evaluate", async (raw) => {
    try {
      const args = parseArgs(
        z.object({
          pair: pairArg,
          side: z.enum(["BUY", "SELL"]),
          quantity: z.number().positive(),
          price: z.number().positive(),
          mode: z.enum(["paper", "live"]).optional(),
        }),
        raw,
      );
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
      return ok({
        outcome: decision.outcome,
        reasons: decision.reasons,
        message: decision.message,
      });
    } catch (error) {
      return fail(error);
    }
  });
}
