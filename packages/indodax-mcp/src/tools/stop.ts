import { z } from "zod";
import { ValidationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { getTicker } from "@indodax-mcp/indodax-market";
import { decimalOrNull } from "@indodax-mcp/core";
import { fail, ok, parseArgs } from "../respond.js";
import { pairArg, priceArg, quantityArg, sideArg } from "../schemas.js";
import type { AppServices } from "../composition.js";
import { placeLiveOrder } from "./order-intent.js";
import { placePaperOrder } from "./paper.js";

const STOP = {
  capability: "TRADE" as const,
  riskClass: "mutation" as const,
  environmentRequirement: "paper" as const,
  authRequirement: "none" as const,
  destructive: false,
  idempotencyClass: "client-key" as const,
  auditClass: "mutation" as const,
};

const STOP_READ = { ...STOP, riskClass: "read" as const, auditClass: "read" as const };

const stopInput = z.object({
  pair: pairArg,
  side: sideArg,
  quantity: quantityArg,
  stopPrice: priceArg,
  limitPrice: priceArg.optional(),
  mode: z.enum(["paper", "live"]).optional(),
  acknowledged: z.boolean().optional(),
  clientOrderId: z.string().min(1).max(36).optional(),
  timeInForce: z.enum(["GTC", "MOC"]).optional(),
  stpMode: z.enum(["EXPIRE_TAKER", "EXPIRE_MAKER", "EXPIRE_BOTH"]).optional(),
});

function crossed(side: "BUY" | "SELL", last: number, stopPrice: number): boolean {
  return side === "SELL" ? last <= stopPrice : last >= stopPrice;
}

export interface StopFireResult {
  checked: number;
  fired: { id: string; status: string; price?: number; reason?: string }[];
}

/** Shared trigger evaluation used by the tool and the optional autopoll job. */
export async function evaluateStops(app: AppServices): Promise<StopFireResult> {
  const fired: StopFireResult["fired"] = [];
  for (const stop of app.stops.list()) {
    let last: number | null = null;
    try {
      const ticker = await getTicker(app.publicClient, stop.pair);
      const parsed = decimalOrNull(ticker.last);
      last = parsed ? parsed.toNumber() : null;
    } catch {
      last = null;
    }
    if (last === null || !crossed(stop.side, last, stop.stopPrice)) continue;
    try {
      const result =
        stop.mode === "live"
          ? await placeLiveOrder(app, {
              pair: stop.pair,
              side: stop.side,
              quantity: stop.quantity,
              price: stop.limitPrice,
              ...(stop.clientOrderId !== undefined ? { clientOrderId: stop.clientOrderId } : {}),
              ...(stop.timeInForce !== undefined ? { timeInForce: stop.timeInForce } : {}),
              ...(stop.stpMode !== undefined ? { stpMode: stop.stpMode } : {}),
              acknowledged: true,
            })
          : await placePaperOrder(app, {
              pair: stop.pair,
              side: stop.side,
              orderType: "LIMIT",
              price: stop.limitPrice,
              quantity: stop.quantity,
              ...(stop.clientOrderId !== undefined ? { clientOrderId: stop.clientOrderId } : {}),
            });
      app.stops.mark(stop.id, "triggered", { result });
      fired.push({ id: stop.id, status: "triggered", price: last });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      app.stops.mark(stop.id, "failed", { reason });
      fired.push({ id: stop.id, status: "failed", reason });
    }
  }
  return { checked: app.stops.list(true).length, fired };
}

export function registerStopTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool({
    metadata: {
      name: "indodax_stop_create",
      title: "Create stop",
      description:
        "Server-side emulated stop, not exchange-native. Stores a trigger; nothing is placed until indodax_stop_check sees the stop price crossed. Live needs acknowledged true plus the full live gate. Args: pair, side, quantity, stopPrice, optional limitPrice defaulting to stopPrice.",
      ...STOP,
    },
    inputSchema: stopInput,
  });
  registry.registerTool({
    metadata: {
      name: "indodax_stops",
      title: "List stops",
      description: "Read-only. List open server-side stops, or include history with history true.",
      ...STOP_READ,
    },
    inputSchema: z.object({ history: z.boolean().optional() }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_stop_cancel",
      title: "Cancel stop",
      description: "Mutating local state. Cancel one open stop by id before it triggers.",
      ...STOP,
    },
    inputSchema: z.object({ id: z.string().min(1) }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_stop_check",
      title: "Check stops",
      description:
        "Mutating when triggers fire. Evaluate open stops against live prices and execute crossed ones as LIMIT orders through risk. Paper fills nothing by itself; use indodax_paper_fill after.",
      ...STOP,
    },
    inputSchema: z.object({}),
  });

  handlers.tools.set("indodax_stop_create", async (raw) => {
    try {
      const args = parseArgs(stopInput, raw);
      const mode = args.mode ?? "paper";
      if (mode === "live") {
        if (args.acknowledged !== true) {
          throw ValidationError("live stops need acknowledged true");
        }
        if (app.env.APP_ENV !== "live" || app.env.TRADE_ENABLED !== true) {
          throw ValidationError("live stops need APP_ENV=live and TRADE_ENABLED=true");
        }
        if (!app.accountClient || !app.liveExecutor) {
          throw ValidationError("live stops need API credentials");
        }
      }
      const stop = app.stops.add({
        pair: args.pair,
        side: args.side,
        quantity: args.quantity,
        stopPrice: args.stopPrice,
        limitPrice: args.limitPrice ?? args.stopPrice,
        mode,
        ...(args.clientOrderId !== undefined ? { clientOrderId: args.clientOrderId } : {}),
        ...(args.timeInForce !== undefined ? { timeInForce: args.timeInForce } : {}),
        ...(args.stpMode !== undefined ? { stpMode: args.stpMode } : {}),
      });
      return ok({ id: stop.id, status: stop.status });
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_stops", async (raw) => {
    try {
      const args = parseArgs(z.object({ history: z.boolean().optional() }), raw);
      return ok(app.stops.list(args.history ?? false));
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_stop_cancel", async (raw) => {
    try {
      const args = parseArgs(z.object({ id: z.string().min(1) }), raw);
      const cancelled = app.stops.cancel(args.id);
      if (!cancelled) throw ValidationError(`stop ${args.id} is not open`);
      return ok({ id: args.id, status: "cancelled" });
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_stop_check", async () => {
    try {
      return ok(await evaluateStops(app));
    } catch (error) {
      return fail(error);
    }
  });
}
