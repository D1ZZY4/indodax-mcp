import { z } from "zod";
import { ValidationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { getTicker } from "@indodax-mcp/indodax-market";
import type { PriceAlert } from "@indodax-mcp/indodax-alerts";
import { fail, ok, parseArgs } from "@indodax-mcp/indodax-mcp/respond";
import { canonicalPair, pairArg } from "@indodax-mcp/indodax-mcp/schemas";
import { defineTool } from "@indodax-mcp/indodax-mcp/tools/define";
import type { AppServices } from "@indodax-mcp/indodax-mcp/composition";

export interface AlertFireResult {
  checked: number;
  triggered: PriceAlert[];
}

/** Shared alert evaluation used by the tool and the optional autopoll job. */
export async function evaluateAlerts(app: AppServices): Promise<AlertFireResult> {
  const active = app.alerts.list();
  const pairs = [...new Set(active.map((alert) => alert.pair))];
  const triggered: PriceAlert[] = [];
  for (const pair of pairs) {
    let last: string | null = null;
    try {
      const ticker = await getTicker(app.publicClient, pair);
      // Keep the exchange string form so precise prices never pass through
      // a binary float before threshold comparison.
      last = ticker.last;
    } catch {
      last = null;
    }
    if (last === null) continue;
    triggered.push(...app.alerts.check(pair, last));
  }
  return { checked: active.length, triggered };
}

const alertsList = defineTool(
  {
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
  { history: z.boolean().optional() },
);

const alertCreate = defineTool(
  {
    name: "indodax_alert_create",
    title: "Create alert",
    description:
      "Persist a price alert for one pair. Args: pair plus exactly one flat condition field: above, " +
      "below, percentUp, or percentDown, and an optional note. The condition is the flat field itself, " +
      "not a nested object; for example {pair:'ton_idr', below:24763.44548379} fires when the price " +
      "drops to that level. Percent modes anchor to the price at creation time. Returns the alert id.",
    capability: "READ",
    riskClass: "mutation",
    environmentRequirement: "any",
    authRequirement: "none",
    destructive: false,
    idempotencyClass: "none",
    auditClass: "mutation",
  },
  {
    pair: pairArg,
    above: z.number().positive().optional(),
    below: z.number().positive().optional(),
    percentUp: z.number().positive().optional(),
    percentDown: z.number().positive().optional(),
    note: z.string().optional(),
  },
);

const alertCancel = defineTool(
  {
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
  { id: z.string().min(1) },
);

const alertCheck = defineTool(
  {
    name: "indodax_alert_check",
    title: "Check alerts",
    description:
      "Mutating local state. Evaluate active alerts for one pair against the current market price. " +
      "Args: pair. The price comes from the shared ticker cache, so priceSource and priceAgeMs state " +
      "whether it was a live read or a cached row. triggeredCount counts only alerts this call " +
      "retired; an alert already retired by the scheduled autopoll appears in alreadyTriggered, so a " +
      "zero triggeredCount never means the condition was never met.",
    capability: "READ",
    riskClass: "mutation",
    environmentRequirement: "any",
    authRequirement: "none",
    destructive: false,
    idempotencyClass: "none",
    auditClass: "mutation",
  },
  { pair: pairArg },
);

export function registerAlertTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool(alertsList);
  registry.registerTool(alertCreate);
  registry.registerTool(alertCancel);
  registry.registerTool(alertCheck);

  handlers.tools.set("indodax_alerts", async (raw) => {
    try {
      const args = parseArgs(alertsList.inputSchema, raw);
      const alerts = app.alerts.list(args.history ?? false);
      const active = alerts.filter((alert) => alert.status === "active").length;
      return ok({
        count: alerts.length,
        active,
        triggered: alerts.filter((alert) => alert.status === "triggered").length,
        cancelled: alerts.filter((alert) => alert.status === "cancelled").length,
        alerts,
        pairs: [...new Set(alerts.map((alert) => alert.pair))],
        summary: `${alerts.length} alerts (${active} active)`,
        note: "Server-local alerts evaluated against live public prices; the exchange has no alert API.",
      });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_alert_create", async (raw) => {
    try {
      const args = parseArgs(alertCreate.inputSchema, raw);
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
        pair: canonicalPair(args.pair),
        condition,
        ...(args.note !== undefined ? { note: args.note } : {}),
      });
      return ok({
        id: alert.id,
        status: alert.status,
        alert,
        pair: alert.pair,
        condition: alert.condition,
        createdAt: alert.createdAt,
        totalAlerts: app.alerts.list(true).length,
        summary: `alert ${alert.id} armed for ${alert.pair}`,
        note: "Percent modes anchored to the live price at creation. Evaluate with indodax_alert_check or autopoll.",
      });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_alert_cancel", async (raw) => {
    try {
      const args = parseArgs(alertCancel.inputSchema, raw);
      const before = app.alerts.list(true).find((alert) => alert.id === args.id) ?? null;
      const cancelled = app.alerts.cancel(args.id);
      if (!cancelled) throw ValidationError(`alert ${args.id} is not active`);
      return ok({
        id: args.id,
        status: "cancelled",
        cancelledAlert: before,
        remainingActive: app.alerts.list().length,
        summary: `alert ${args.id} cancelled`,
      });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_alert_check", async (raw) => {
    try {
      const args = parseArgs(alertCheck.inputSchema, raw);
      const pair = canonicalPair(args.pair);
      const ticker = await getTicker(app.publicClient, pair);
      const triggered = app.alerts.check(pair, ticker.last);
      // Anything already retired for this pair, including rows a background
      // autopoll consumed. Without this a caller reading triggeredCount alone
      // cannot tell "condition never met" from "condition met and someone
      // else already acted on it", which is a false negative on a trigger.
      const alreadyTriggered = app.alerts.triggeredFor(pair);
      const priceSource = ticker.source;
      const priceAgeMs = ticker.ageMs;
      return ok({
        pair,
        price: ticker.last,
        priceSource,
        priceAgeMs,
        priceStale: ticker.stale,
        checkedAt: new Date().toISOString(),
        count: triggered.length,
        triggered,
        alerts: triggered,
        triggeredCount: triggered.length,
        alreadyTriggered,
        alreadyTriggeredCount: alreadyTriggered.length,
        remainingActive: app.alerts.list().length,
        summary:
          triggered.length > 0
            ? `${triggered.length} alert(s) triggered for ${pair} at ${ticker.last}`
            : alreadyTriggered.length > 0
              ? `no new alert for ${pair} at ${ticker.last}, but ${alreadyTriggered.length} already triggered earlier (see alreadyTriggered)`
              : `no alerts triggered for ${pair} at ${ticker.last}`,
        note:
          alreadyTriggered.length > 0
            ? "alreadyTriggered lists alerts already retired as triggered, so this call retiring none does not mean the condition was never met"
            : "price comes from the shared ticker cache; use indodax_orderbook when a live top of book is required",
      });
    } catch (error) {
      return fail(error);
    }
  });
}
