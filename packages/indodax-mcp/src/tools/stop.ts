import { z } from "zod";
import { ValidationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { fail, ok, parseArgs } from "@indodax-mcp/mcp-app/respond";
import { defineTool } from "@indodax-mcp/mcp-app/tools/define";
import type { AppServices } from "@indodax-mcp/mcp-app/composition";
import { STOP, STOP_READ } from "@indodax-mcp/mcp-app/tools/stop-shared";
import { registerStopCreateTools } from "@indodax-mcp/mcp-app/tools/stop-create";
import { registerStopCheckTools } from "@indodax-mcp/mcp-app/tools/stop-check";

/**
 * The MCP surface for server-side stops: create, list, cancel, and check.
 *
 * Creation lives in `stop-create` and evaluation in `stop-check`; trigger
 * evaluation itself lives in `stop-trigger` so the autopoll and the tools
 * share one decision path. This module keeps the shared re-exports plus the
 * small list and cancel surfaces.
 */
export { evaluateStops } from "@indodax-mcp/mcp-app/stop-trigger";
export type { StopFireResult } from "@indodax-mcp/mcp-app/stop-trigger";
export {
  isLiquidityBlock,
  isRetryableStopFailure,
} from "@indodax-mcp/mcp-app/stop-classification";

const stopsList = defineTool(
  {
    name: "indodax_stops",
    title: "List stops",
    description: "Read-only. List open server-side stops, or include history with history true.",
    ...STOP_READ,
  },
  { history: z.boolean().optional() },
);

const stopCancel = defineTool(
  {
    name: "indodax_stop_cancel",
    title: "Cancel stop",
    description: "Mutating local state. Cancel one open stop by id before it triggers.",
    ...STOP,
  },
  { id: z.string().min(1) },
);

export function registerStopTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registerStopCreateTools(registry, handlers, app);
  registerStopCheckTools(registry, handlers, app);
  registry.registerTool(stopsList);
  registry.registerTool(stopCancel);

  handlers.tools.set("indodax_stops", async (raw) => {
    try {
      const args = parseArgs(stopsList.inputSchema, raw);
      const stops = app.stops.list(args.history ?? false);
      const blocked = stops.filter((stop) => stop.status === "blocked");
      const payload: Record<string, unknown> = {
        count: stops.length,
        open: stops.filter((stop) => stop.status === "open").length,
        // Blocked stops are armed protection that could not place, so they are
        // counted separately rather than folded into `open`: a stop that can
        // never fire is not the same as one that can.
        blocked: blocked.length,
        stops,
        pairs: [...new Set(stops.map((stop) => stop.pair))],
        summary: `${stops.length} stops listed`,
      };
      if (blocked.length > 0) {
        payload.blockedStops = blocked.map((stop) => ({
          id: stop.id,
          pair: stop.pair,
          quantity: stop.quantity,
          reason: stop.blockedReason ?? stop.reason ?? null,
          fix: stop.blockedFix ?? null,
        }));
        payload.note =
          "a blocked stop is still armed protection whose placement was refused; it retries on the next check";
      }
      return ok(payload);
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_stop_cancel", async (raw) => {
    try {
      const args = parseArgs(stopCancel.inputSchema, raw);
      const before = app.stops.list(true).find((stop) => stop.id === args.id) ?? null;
      const cancelled = app.stops.cancel(args.id);
      if (!cancelled) throw ValidationError(`stop ${args.id} is not open`);
      return ok({
        id: args.id,
        status: "cancelled",
        cancelledStop: before,
        remainingOpen: app.stops.list().length,
        summary: `stop ${args.id} cancelled`,
      });
    } catch (error) {
      return fail(error);
    }
  });
}
