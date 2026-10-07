import { z } from "zod";
import { ValidationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { fail, ok, parseArgs } from "@indodax-mcp/indodax-mcp/respond";
import { defineTool } from "@indodax-mcp/indodax-mcp/tools/define";
import type { AppServices } from "@indodax-mcp/indodax-mcp/composition";
import { STOP } from "@indodax-mcp/indodax-mcp/tools/stop-shared";
import { evaluateStops } from "@indodax-mcp/indodax-mcp/stop-trigger";

/**
 * Stop evaluation surface: periodic checks plus explicit single-stop retry.
 *
 * Trigger evaluation itself lives in `stop-trigger` so the autopoll and these
 * tools share one decision path.
 */

const stopCheck = defineTool(
  {
    name: "indodax_stop_check",
    title: "Check stops",
    description:
      "Mutating when triggers fire. Evaluate open stops against live prices and execute crossed ones as LIMIT orders through risk. Blocked stops retry automatically on every pass and on the opt-in autopoll. A fired stop auto-cancels open siblings in its OCO group. Paper fills nothing by itself; use indodax_paper_fill after.",
    ...STOP,
  },
  {},
);

const stopRetry = defineTool(
  {
    name: "indodax_stop_retry",
    title: "Retry stop",
    description:
      "Mutating when the trigger fires. Re-arm one blocked stop and re-evaluate it against the live price immediately instead of waiting for the next stop_check or autopoll pass. Args: id required. Only a blocked stop needs this; open stops already evaluate on every check.",
    ...STOP,
  },
  { id: z.string().min(1) },
);

export function registerStopCheckTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool(stopCheck);
  registry.registerTool(stopRetry);

  handlers.tools.set("indodax_stop_check", async () => {
    try {
      const result = await evaluateStops(app);
      const retry = result.fired.filter((entry) => entry.retryable === true);
      const blocked = result.fired.filter((entry) => entry.status === "blocked");
      return ok({
        ...result,
        openStops: app.stops.list().length,
        totalStops: app.stops.list(true).length,
        /** Armed stops whose placement was refused but is worth another cycle. */
        retryable: retry.length,
        retryableStops: retry.map((entry) => ({
          id: entry.id,
          status: entry.status,
          reason: entry.reason,
          fix: entry.fix,
        })),
        /**
         * Stops held up by a reserved quantity, reported on their own.
         *
         * This is the case that produced real losses: the stop triggered, the
         * exchange refused it because a take-profit held the balance, and
         * nothing said so at the time. Naming the blocking order is what turns
         * a silent failure into an action the operator can take.
         */
        blocked: blocked.length,
        blockedStops: blocked.map((entry) => ({
          id: entry.id,
          reason: entry.reason,
          fix: entry.fix,
        })),
        protectionIntact:
          blocked.length > 0
            ? "a stop crossed its price and could not place because the quantity is reserved by another order; it stays armed and retries once that order is cancelled. use indodax_oco_attach to link the two automatically"
            : retry.length > 0
              ? "a stop crossed its price but was not placed; it is still open, refresh the account and check again"
              : null,
        summary:
          blocked.length > 0
            ? `${blocked.length} stop(s) blocked by a reserved quantity, still armed, of ${result.checked} checked`
            : retry.length > 0
              ? `${retry.length} stop(s) still armed after a refreshable failure of ${result.checked} checked`
              : result.fired.length > 0
                ? `${result.fired.length} stop(s) fired of ${result.checked} checked`
                : `${result.checked} stops checked, none crossed`,
      });
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_stop_retry", async (raw) => {
    try {
      const args = parseArgs(stopRetry.inputSchema, raw);
      const existing = app.stops.list(true).find((stop) => stop.id === args.id) ?? null;
      if (existing === null) throw ValidationError(`stop ${args.id} not found`);
      if (existing.status !== "blocked") {
        throw ValidationError(
          `stop ${args.id} is ${existing.status}, not blocked; only a blocked stop ` +
            "needs a retry because open stops already evaluate on every stop_check",
        );
      }
      // Clear the recorded block so this pass judges the live state, not the
      // previous refusal. When the quantity is still reserved the stop blocks
      // again with a fresh assessment instead of hanging on stale evidence.
      app.stops.unblock(args.id);
      const result = await evaluateStops(app);
      const entry = result.fired.find((fired) => fired.id === args.id) ?? null;
      return ok({
        id: args.id,
        status: entry?.status ?? "open",
        result: entry,
        checked: result.checked,
        openStops: app.stops.list().length,
        summary:
          entry === null
            ? `stop ${args.id} re-armed and re-evaluated; no trigger fired on this pass`
            : `stop ${args.id} retried with status ${entry.status}`,
        note: "Blocked stops also retry automatically on every stop_check and autopoll pass.",
      });
    } catch (error) {
      return fail(error);
    }
  });
}
