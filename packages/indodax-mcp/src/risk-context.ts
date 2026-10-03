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
 * - market age is the time since the last successful ticker read for the
 *   pair (0 on a fresh read). The read is best-effort: when the exchange
 *   has never been reached the field stays null and the engine skips the
 *   staleness check, so paper simulation keeps working offline;
 * - account age comes from the last successful authenticated read;
 * - trade count, cooldown, duplicate, position exposure, and daily PnL come
 *   from the live paper ledger. Daily PnL is realized fills plus unrealized
 *   open BUY positions marked at live prices (average-cost basis, fees
 *   included; assets without tracked basis are skipped, never invented);
 * - reconciliation halt is tracked from paper-local consistency checks and
 *   full exchange reconciliation; it is enforced for every mode because an
 *   inconsistent local ledger must not keep executing either.
 */

/** Last successful ticker read per canonical pair. Shared so staleness grows while offline. */
const tickerSeenAt = new Map<string, number>();

async function readMarket(
  app: AppServices,
  pair: string,
): Promise<{ ageMs: number | null; last: Decimal | null }> {
  const key = pair.toLowerCase();
  try {
    const ticker = await getTicker(app.publicClient, pair);
    tickerSeenAt.set(key, Date.now());
    return { ageMs: 0, last: decimalOrNull(ticker.last) };
  } catch {
    const seen = tickerSeenAt.get(key);
    return { ageMs: seen === undefined ? null : Math.max(0, Date.now() - seen), last: null };
  }
}

export async function resolveRiskContext(
  app: AppServices,
  request: RiskContextRequest,
): Promise<RiskContext> {
  let marketAgeMs: number | null = null;
  if (request.pair !== undefined) {
    marketAgeMs = (await readMarket(app, request.pair)).ageMs;
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
  const realized = decimalOrNull(ledger.realizedByDay[currentUtcDay()] ?? "0") ?? new Decimal(0);
  const unrealized = await unrealizedOpenPnl(app, ledger);
  return {
    mode: request.mode,
    capability: request.capability,
    marketAgeMs,
    accountAgeMs:
      app.accountSyncedAt === null ? null : Math.max(0, Date.now() - app.accountSyncedAt),
    dailyPnl: realized.plus(unrealized),
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

/**
 * Mark-to-market of open BUY positions at live prices minus average-cost
 * basis. Open SELL orders hold no asset, so they carry no unrealized PnL.
 * A pair whose quote fails contributes nothing rather than a guess.
 */
async function unrealizedOpenPnl(
  app: AppServices,
  ledger: ReturnType<AppServices["paper"]["snapshot"]>,
): Promise<Decimal> {
  let total = new Decimal(0);
  const seenPairs = new Set<string>();
  for (const order of ledger.orders) {
    if (order.side !== "BUY") continue;
    if (order.state !== "ACCEPTED" && order.state !== "PARTIALLY_FILLED") continue;
    const pair = `${order.symbol.base}_${order.symbol.quote}`;
    if (seenPairs.has(pair)) continue;
    seenPairs.add(pair);
    const { last } = await readMarket(app, pair);
    if (last === null) continue;
    const remaining = decimalOrNull(order.remaining);
    const basis = ledger.costBasis[order.symbol.base];
    const basisQty = basis ? decimalOrNull(basis.qty) : null;
    const basisTotal = basis ? decimalOrNull(basis.total) : null;
    if (remaining === null || basisQty === null || basisTotal === null || basisQty.lte(0)) {
      continue;
    }
    total = total.plus(last.minus(basisTotal.div(basisQty)).mul(remaining));
  }
  return total;
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
