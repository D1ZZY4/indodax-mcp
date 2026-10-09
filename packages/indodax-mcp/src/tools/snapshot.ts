import { z } from "zod";
import { AuthenticationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { fail, ok, parseArgs } from "@indodax-mcp/mcp-app/respond";
import { defineTool } from "@indodax-mcp/mcp-app/tools/define";
import { livePositions } from "@indodax-mcp/mcp-app/tools/positions";
import type { AppServices } from "@indodax-mcp/mcp-app/composition";

/**
 * One-call loop snapshot.
 *
 * A monitoring loop otherwise pays five to seven round-trips per iteration
 * (account, tickers, alerts, orders, stops, positions) and reads account
 * state minutes apart across loop turns, which is exactly how
 * STALE_ACCOUNT_STATE denials happen mid-loop. This composes the same
 * primitives server-side seconds apart in a single call, so the whole loop
 * decides on one fresh picture. Read-only: it never places, cancels, or
 * arms anything.
 */

interface OpenOrderRow {
  orderId?: string | number;
  fullOrderId?: string;
  clientOrderId?: string;
  symbol?: string;
  side?: string;
  price?: string;
  origQty?: string;
}

const snapshot = defineTool(
  {
    name: "indodax_portfolio_snapshot",
    title: "Portfolio snapshot",
    description:
      "Read-only, needs credentials. One fresh picture for a monitoring loop: IDR balances split free/locked, every holding valued in IDR with stops and alerts attached per leg, live open-order count with the first orders, stop and alert counts, and Deadman state. Replaces account plus ticker plus orders plus stops plus alerts plus positions round-trips. Args: optional entries map of ASSET to average entry price in IDR for per-leg unrealizedPct.",
    capability: "READ",
    riskClass: "read",
    environmentRequirement: "any",
    authRequirement: "credentials",
    destructive: false,
    idempotencyClass: "none",
    auditClass: "read",
  },
  { entries: z.record(z.string(), z.string()).optional() },
);

export function registerSnapshotTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool(snapshot);

  handlers.tools.set("indodax_portfolio_snapshot", async (raw) => {
    try {
      const args = parseArgs(snapshot.inputSchema, raw);
      if (!app.accountClient) {
        throw AuthenticationError("no API credentials configured for this private tool");
      }
      // The positions valuation below takes its own fresh authenticated read,
      // so this snapshot never mixes ages: everything derives from reads
      // seconds apart in a single call.
      const valued = await livePositions(app, args.entries);
      const syncedAt = app.accountSyncedAt ?? Date.now();
      const rawOrders = (await app.accountClient.openOrders()) as unknown[];
      const orders = (Array.isArray(rawOrders) ? rawOrders : []).slice(0, 25);
      const idr = valued.legs.find((leg) => leg.asset === "idr");
      const history = app.alerts.list(true);
      const alerts = app.alerts.list();
      const triggeredAlerts = history.filter((alert) => alert.status === "triggered");
      const cancelledAlerts = history.filter((alert) => alert.status === "cancelled");
      return ok({
        asOf: new Date(syncedAt).toISOString(),
        idr: {
          free: idr?.free ?? "0",
          locked: idr?.locked ?? "0",
          total: idr?.total ?? "0",
        },
        legs: valued.legs,
        totalIdr: valued.totalIdr,
        incomplete: valued.incomplete,
        openOrders: {
          count: Array.isArray(rawOrders) ? rawOrders.length : 0,
          truncated: Array.isArray(rawOrders) && rawOrders.length > orders.length,
          observedAt: new Date().toISOString(),
          orders: orders.map((item) => {
            const row = item as OpenOrderRow;
            return {
              orderId: row.orderId ?? row.fullOrderId ?? null,
              clientOrderId: row.clientOrderId ?? null,
              symbol: row.symbol ?? null,
              side: typeof row.side === "string" ? row.side.toUpperCase() : null,
              price: row.price === undefined ? null : String(row.price),
              quantity: row.origQty === undefined ? null : String(row.origQty),
            };
          }),
        },
        stops: {
          open: app.stops.list().filter((stop) => stop.status === "open").length,
          blocked: app.stops.list().filter((stop) => stop.status === "blocked").length,
        },
        /**
         * Triggered and cancelled counts come from the full history, not the
         * active list. A monitoring loop that only sees active alerts cannot
         * distinguish "no alert armed" from "the alert fired and someone already
         * acted on it", which is the same false negative an alert check has.
         */
        alerts: {
          active: alerts.filter((alert) => alert.status === "active").length,
          triggered: triggeredAlerts.length,
          cancelled: cancelledAlerts.length,
          pairs: [...new Set(alerts.map((alert) => alert.pair))],
        },
        deadman: app.deadman.snapshot(),
        notes: valued.notes,
        summary:
          `snapshot at ${valued.totalIdr ?? "unknown"} IDR across ` +
          `${valued.legs.length} leg(s), ` +
          `${Array.isArray(rawOrders) ? rawOrders.length : 0} open order(s)`,
      });
    } catch (error) {
      return fail(error);
    }
  });
}
