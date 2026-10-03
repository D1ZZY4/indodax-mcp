import { z } from "zod";
import { ValidationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { getTicker } from "@indodax-mcp/indodax-market";
import { fail, ok, parseArgs } from "../respond.js";
import { pairArg } from "../schemas.js";
import type { AppServices } from "../composition.js";

export function registerAlertTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool({
    metadata: {
      name: "indodax_alerts",
      title: "Alerts",
      description: "Read-only. List active alerts, or include history with history true.",
      capability: "READ",
      riskClass: "read",
      environmentRequirement: "any",
      authRequirement: "none",
      destructive: false,
      idempotencyClass: "none",
      auditClass: "read",
    },
    inputSchema: z.object({ history: z.boolean().optional() }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_alert_create",
      title: "Create alert",
      description:
        "Persist a price alert for one pair. Exactly one of above, below, percentUp, percentDown. Returns the alert id.",
      capability: "READ",
      riskClass: "mutation",
      environmentRequirement: "any",
      authRequirement: "none",
      destructive: false,
      idempotencyClass: "none",
      auditClass: "mutation",
    },
    inputSchema: z.object({
      pair: pairArg,
      above: z.number().positive().optional(),
      below: z.number().positive().optional(),
      percentUp: z.number().positive().optional(),
      percentDown: z.number().positive().optional(),
      note: z.string().optional(),
    }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_alert_cancel",
      title: "Cancel alert",
      description: "Mutating local state. Cancel one active alert by id. Args: id required.",
      capability: "READ",
      riskClass: "mutation",
      environmentRequirement: "any",
      authRequirement: "none",
      destructive: false,
      idempotencyClass: "none",
      auditClass: "mutation",
    },
    inputSchema: z.object({ id: z.string().min(1) }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_alert_check",
      title: "Check alerts",
      description:
        "Mutating local state. Evaluate active alerts for one pair against the live price.",
      capability: "READ",
      riskClass: "mutation",
      environmentRequirement: "any",
      authRequirement: "none",
      destructive: false,
      idempotencyClass: "none",
      auditClass: "mutation",
    },
    inputSchema: z.object({ pair: pairArg }),
  });

  handlers.tools.set("indodax_alerts", async (raw) => {
    try {
      const args = parseArgs(z.object({ history: z.boolean().optional() }), raw);
      return ok(app.alerts.list(args.history ?? false));
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_alert_create", async (raw) => {
    try {
      const args = parseArgs(
        z.object({
          pair: pairArg,
          above: z.number().positive().optional(),
          below: z.number().positive().optional(),
          percentUp: z.number().positive().optional(),
          percentDown: z.number().positive().optional(),
          note: z.string().optional(),
        }),
        raw,
      );
      const triggers = [args.above, args.below, args.percentUp, args.percentDown].filter(
        (value) => value !== undefined,
      );
      if (triggers.length !== 1) {
        throw ValidationError("provide exactly one of above, below, percentUp, percentDown");
      }
      let condition:
        | { type: "above"; price: string }
        | { type: "below"; price: string }
        | { type: "risePct"; percent: string; reference: string }
        | { type: "fallPct"; percent: string; reference: string };
      if (args.above !== undefined) {
        condition = { type: "above", price: String(args.above) };
      } else if (args.below !== undefined) {
        condition = { type: "below", price: String(args.below) };
      } else {
        const ticker = await getTicker(app.publicClient, args.pair);
        const reference = String(ticker.last);
        condition =
          args.percentUp !== undefined
            ? { type: "risePct", percent: String(args.percentUp), reference }
            : { type: "fallPct", percent: String(args.percentDown ?? 0), reference };
      }
      const alert = app.alerts.add({
        pair: args.pair.toLowerCase().replace(/[-/]/g, "_"),
        condition,
        ...(args.note !== undefined ? { note: args.note } : {}),
      });
      return ok({ id: alert.id, status: alert.status });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_alert_cancel", async (raw) => {
    try {
      const args = parseArgs(z.object({ id: z.string().min(1) }), raw);
      const cancelled = app.alerts.cancel(args.id);
      if (!cancelled) throw ValidationError(`alert ${args.id} is not active`);
      return ok({ id: args.id, status: "cancelled" });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_alert_check", async (raw) => {
    try {
      const args = parseArgs(z.object({ pair: pairArg }), raw);
      const ticker = await getTicker(app.publicClient, args.pair);
      const triggered = app.alerts.check(args.pair, Number(ticker.last));
      return ok({ pair: args.pair, price: ticker.last, triggered });
    } catch (error) {
      return fail(error);
    }
  });
}
