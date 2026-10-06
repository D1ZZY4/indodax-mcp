import Decimal from "decimal.js";
import type { Capability, ExecutionMode } from "@indodax-mcp/core";
import { decimalOrNull } from "@indodax-mcp/core";
import { getTicker, isMarketSuspended } from "@indodax-mcp/indodax-market";
import { currentUtcDay } from "@indodax-mcp/indodax-paper";
import type { RiskContext } from "@indodax-mcp/indodax-risk";
import { checkPaperConsistency } from "@indodax-mcp/indodax-mcp/paper-consistency";
import type { AppServices } from "@indodax-mcp/indodax-mcp/composition";

export interface RiskContextRequest {
  mode: ExecutionMode;
  capability: Capability;
  /** Canonical pair like btc_idr when the evaluation concerns one market. */
  pair?: string | undefined;
  /** Client order id for duplicate detection. Null skips the check. */
  clientOrderId?: string | null | undefined;
  /** Quote-side sufficiency computed by the caller (paper balances, live pre-check). */
  balanceSufficient?: boolean | null | undefined;
  /**
   * Skip the inter-order cooldown for a continuation leg of one intent.
   *
   * The cooldown exists to slow down an agent submitting repeated separate
   * orders. A single OCO bundle is one decision that must place several legs,
   * so without this every leg after the first was refused and the bundle
   * reported a half-protected position. Every other check, including limits,
   * deadman, balance, and reconciliation, still runs per leg.
   */
  ignoreCooldown?: boolean | undefined;
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
const MAX_TRACKED_PAIRS = 500;

function rememberTicker(key: string, nowMs: number): void {
  if (!tickerSeenAt.has(key) && tickerSeenAt.size >= MAX_TRACKED_PAIRS) {
    const oldest = tickerSeenAt.keys().next().value;
    if (oldest !== undefined) tickerSeenAt.delete(oldest);
  }
  tickerSeenAt.set(key, nowMs);
}

async function readMarket(
  app: AppServices,
  pair: string,
): Promise<{ ageMs: number | null; last: Decimal | null }> {
  const key = pair.toLowerCase();
  const nowMs = Date.now();
  try {
    const ticker = await getTicker(app.publicClient, pair);
    // getTicker serves a 30s cache; fetchedAt marks the real exchange read
    // so cached rows report their true age instead of 0. Remember the true
    // read time as well, so offline staleness grows from the last exchange
    // read rather than from the last cached serve.
    const readAt = Date.parse(ticker.fetchedAt);
    const effectiveAt = Number.isFinite(readAt) ? (readAt as number) : nowMs;
    rememberTicker(key, effectiveAt);
    const ageMs = Number.isFinite(readAt) ? Math.max(0, nowMs - (readAt as number)) : 0;
    return { ageMs, last: decimalOrNull(ticker.last) };
  } catch {
    const seen = tickerSeenAt.get(key);
    return { ageMs: seen === undefined ? null : Math.max(0, nowMs - seen), last: null };
  }
}

export async function resolveRiskContext(
  app: AppServices,
  request: RiskContextRequest,
): Promise<RiskContext> {
  // Derived at evaluation time rather than cached by a tool call, so the
  // trading gate cannot be opened or closed by an unrelated read.
  app.reconciliationHalted = checkPaperConsistency(app).state === "MISMATCH";
  let marketAgeMs: number | null = null;
  let marketSuspended: boolean | null = null;
  if (request.pair !== undefined) {
    marketAgeMs = (await readMarket(app, request.pair)).ageMs;
    try {
      marketSuspended = await isMarketSuspended(app.publicClient, request.pair);
    } catch {
      marketSuspended = null;
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
    // DISARMED is an explicit opt-out of heartbeat protection, so it never
    // counts as unknown. STALE and EXPIRED still halt live trading below.
    deadmanUnknown: false,
    deadmanState: app.deadman.snapshot().state,
    balanceSufficient: request.balanceSufficient ?? null,
    marketSuspended,
    positionNotional: openExposure(ledger.orders),
    lastOrderAtMs:
      request.ignoreCooldown === true || lastSubmitted.length === 0
        ? null
        : Math.max(...lastSubmitted),
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
  const remainingByPair = new Map<string, Decimal>();
  for (const order of ledger.orders) {
    if (order.side !== "BUY") continue;
    if (order.state !== "ACCEPTED" && order.state !== "PARTIALLY_FILLED") continue;
    const pair = `${order.symbol.base}_${order.symbol.quote}`;
    const remaining = decimalOrNull(order.remaining);
    if (remaining === null) continue;
    remainingByPair.set(pair, (remainingByPair.get(pair) ?? new Decimal(0)).plus(remaining));
  }
  for (const [pair, remaining] of remainingByPair) {
    const { last } = await readMarket(app, pair);
    if (last === null) continue;
    const base = pair.slice(0, pair.lastIndexOf("_"));
    const basis = ledger.costBasis[base];
    const basisQty = basis ? decimalOrNull(basis.qty) : null;
    const basisTotal = basis ? decimalOrNull(basis.total) : null;
    if (basisQty === null || basisTotal === null || basisQty.lte(0)) {
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
