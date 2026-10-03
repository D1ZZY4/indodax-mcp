import Decimal from "decimal.js";
import type { Capability, ExecutionMode } from "@indodax-mcp/core";
import { decimalOrNull } from "@indodax-mcp/core";
import { getTicker } from "@indodax-mcp/indodax-market";
import { currentUtcDay } from "@indodax-mcp/indodax-paper";
import type { RiskContext } from "@indodax-mcp/indodax-risk";
import type { AppServices } from "./composition.js";

export interface RiskContextRequest {
  mode: ExecutionMode;
  capability: Capability;
  /** Canonical pair like btc_idr when the evaluation concerns one market. */
  pair?: string | undefined;
  /** Client order id for duplicate detection. Null skips the check. */
  clientOrderId?: string | null | undefined;
  /** Quote-side sufficiency computed by the caller (paper balances, live pre-check). */
  balanceSufficient?: boolean | null | undefined;
}

/**
 * Authoritative runtime risk context. Every field is derived from current
 * application state instead of fixed placeholders:
 *
 * - market age comes from a live ticker read (0 on success). The read is
 *   best-effort: when the exchange is unreachable the field stays null and
 *   the engine skips the staleness check, so paper simulation keeps working
 *   offline while limits, balances, and cooldowns are still enforced;
 * - account age comes from the last successful authenticated read;
 * - trade count, cooldown, duplicate, position exposure, and daily realized
 *   PnL come from the live paper ledger (average-cost basis, fees included);
 * - reconciliation halt is tracked from paper-local consistency checks and
 *   full exchange reconciliation; it is enforced for every mode because an
 *   inconsistent local ledger must not keep executing either.
 */
export async function resolveRiskContext(
  app: AppServices,
  request: RiskContextRequest,
): Promise<RiskContext> {
  let marketAgeMs: number | null = null;
  if (request.pair !== undefined) {
    try {
      await getTicker(app.publicClient, request.pair);
      marketAgeMs = 0;
    } catch {
      marketAgeMs = null;
    }
  }
  const ledger = app.paper.snapshot();
  const lastSubmitted = ledger.orders
    .map((order) => Date.parse(order.submittedAt))
    .filter((value) => Number.isFinite(value));
  const duplicate =
    request.clientOrderId === null ||
    request.clientOrderId === undefined ||
    request.clientOrderId === ""
      ? false
      : ledger.orders.some((order) => order.clientOrderId === request.clientOrderId);
  return {
    mode: request.mode,
    capability: request.capability,
    marketAgeMs,
    accountAgeMs:
      app.accountSyncedAt === null ? null : Math.max(0, Date.now() - app.accountSyncedAt),
    dailyPnl: decimalOrNull(ledger.realizedByDay[currentUtcDay()] ?? "0") ?? new Decimal(0),
    tradeCount: ledger.tradeCount,
    duplicate,
    reconciliationHalted: app.reconciliationHalted,
    deadmanUnknown: request.mode === "live" && app.deadman.snapshot().state === "DISARMED",
    deadmanState: app.deadman.snapshot().state,
    balanceSufficient: request.balanceSufficient ?? null,
    positionNotional: openExposure(ledger.orders),
    lastOrderAtMs: lastSubmitted.length > 0 ? Math.max(...lastSubmitted) : null,
  };
}

function openExposure(
  orders: { state: string; price: string | null; remaining: string }[],
): Decimal | null {
  let exposure = new Decimal(0);
  for (const order of orders) {
    if (order.state !== "ACCEPTED" && order.state !== "PARTIALLY_FILLED") continue;
    const price = order.price === null ? null : decimalOrNull(order.price);
    const remaining = decimalOrNull(order.remaining);
    if (price === null || remaining === null) return null;
    exposure = exposure.plus(price.mul(remaining));
  }
  return exposure;
}
