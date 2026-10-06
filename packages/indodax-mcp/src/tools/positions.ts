import Decimal from "decimal.js";
import type { PublicClient } from "@indodax-mcp/indodax-client";
import { getTicker, isMarketSuspended } from "@indodax-mcp/indodax-market";
import { getPairsCached } from "@indodax-mcp/indodax-market";
import { ValidationError } from "@indodax-mcp/errors";
import { decimalOrNull } from "@indodax-mcp/core";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { fail, ok, parseArgs } from "@indodax-mcp/indodax-mcp/respond";
import { defineTool } from "@indodax-mcp/indodax-mcp/tools/define";
import type { AppServices } from "@indodax-mcp/indodax-mcp/composition";

/**
 * Live position valuation.
 *
 * A monitoring loop had to recompute unrealized PnL per leg on every pass,
 * which is both wasteful and a source of arithmetic mistakes. Worse, it could
 * not tell whether a leg already had a take profit or a stop, so an operator
 * had to correlate three tools by hand before deciding anything.
 *
 * This computes the whole picture in one call and states plainly when a leg
 * cannot be priced. An unpriced leg reports null and lands in `incomplete`
 * instead of being valued at zero, because a zero here reads as a total loss.
 */

export interface PositionLeg {
  asset: string;
  free: string;
  locked: string;
  total: string;
  /** Pair the holding is valued through, or null when none exists. */
  pair: string | null;
  last: string | null;
  valueIdr: string | null;
  /** Share of total portfolio value, or null when the portfolio is incomplete. */
  weightPct: string | null;
  tradable: boolean;
  suspended: boolean;
  /** Reason the leg cannot be priced, present when pair or last is missing. */
  unpricedReason: string | null;
}

export interface PositionReport {
  legs: PositionLeg[];
  /** Sum of priced legs only. Null when any leg is unpriced. */
  totalIdr: string | null;
  pricedLegs: number;
  totalLegs: number;
  incomplete: string[];
  /** Open stop orders grouped by pair, so protection is visible per leg. */
  stopCoverage: Record<string, string[]>;
  notes: string[];
}

const QUOTE = "idr";

function toDecimal(value: string | undefined): Decimal {
  return decimalOrNull(value ?? "0") ?? new Decimal(0);
}

/**
 * Resolve the pair a holding trades against.
 *
 * Only direct quote markets are considered. A holding with no direct pair is
 * reported unpriced rather than routed through a conversion the user did not
 * ask for.
 */
async function findPair(
  _client: PublicClient,
  asset: string,
  pairs: { ticker_id?: string; base_currency?: string; traded_currency?: string }[],
): Promise<string | null> {
  const direct = pairs.find((info) => {
    const tickerId = info.ticker_id ?? "";
    return tickerId === `${asset}_${QUOTE}` || tickerId === `${QUOTE}_${asset}`;
  });
  if (direct !== undefined) {
    const tickerId = direct.ticker_id ?? "";
    const [first, second] = tickerId.split("_");
    if (first === asset) return tickerId;
    return `${second}_${first}`;
  }
  // The pair list names its currency fields inverted, so a reverse lookup must
  // compare against the traded asset rather than the base.
  return (
    pairs.find(
      (info) =>
        info.traded_currency?.toLowerCase() === asset &&
        info.base_currency?.toLowerCase() === QUOTE,
    )?.ticker_id ?? null
  );
}

export async function livePositions(app: AppServices): Promise<PositionReport> {
  if (!app.accountClient) {
    throw ValidationError(
      "positions need credentials; call indodax_account first or configure INDODAX_API_KEY",
    );
  }
  const account = await app.accountClient.getAccount();
  app.accountSyncedAt = Date.now();

  let pairs: { ticker_id?: string; base_currency?: string; traded_currency?: string }[] = [];
  try {
    pairs = await getPairsCached(app.publicClient);
  } catch {
    // Without the pair list no holding can be mapped to a market.
  }

  const legs: PositionLeg[] = [];
  const incomplete: string[] = [];
  const notes: string[] = [];
  let total = new Decimal(0);
  let anyUnpriced = false;

  for (const balance of account.balances) {
    const asset = balance.asset.toLowerCase();
    const free = toDecimal(balance.free);
    const locked = toDecimal(balance.locked);
    const totalAmount = free.plus(locked);
    if (totalAmount.lte(0)) continue;

    if (asset === QUOTE) {
      total = total.plus(totalAmount);
      legs.push({
        asset,
        free: free.toString(),
        locked: locked.toString(),
        total: totalAmount.toString(),
        pair: null,
        last: null,
        valueIdr: totalAmount.toString(),
        weightPct: null,
        tradable: true,
        suspended: false,
        unpricedReason: null,
      });
      continue;
    }

    const pair = await findPair(app.publicClient, asset, pairs);
    if (pair === null) {
      anyUnpriced = true;
      incomplete.push(asset);
      legs.push({
        asset,
        free: free.toString(),
        locked: locked.toString(),
        total: totalAmount.toString(),
        pair: null,
        last: null,
        valueIdr: null,
        weightPct: null,
        tradable: false,
        suspended: false,
        unpricedReason: `no direct ${asset}_${QUOTE} market`,
      });
      continue;
    }

    let last: Decimal | null = null;
    let suspended = false;
    try {
      const ticker = await getTicker(app.publicClient, pair);
      last = decimalOrNull(ticker.last);
    } catch (error) {
      anyUnpriced = true;
      incomplete.push(asset);
      notes.push(
        `${asset}: market unreadable (${error instanceof Error ? error.message.slice(0, 80) : "unknown"})`,
      );
    }
    try {
      const flag = await isMarketSuspended(app.publicClient, pair);
      suspended = flag === true;
      if (flag === null) {
        notes.push(`${asset}: market state unknown for ${pair}, suspension not enforced`);
      }
    } catch {
      // Suspension stays unknown rather than assumed false.
    }

    if (last === null) {
      legs.push({
        asset,
        free: free.toString(),
        locked: locked.toString(),
        total: totalAmount.toString(),
        pair,
        last: null,
        valueIdr: null,
        weightPct: null,
        tradable: true,
        suspended,
        unpricedReason: "no usable last price for this pair",
      });
      continue;
    }

    const value = totalAmount.mul(last);
    total = total.plus(value);
    legs.push({
      asset,
      free: free.toString(),
      locked: locked.toString(),
      total: totalAmount.toString(),
      pair,
      last: last.toString(),
      valueIdr: value.toString(),
      weightPct: null,
      tradable: true,
      suspended,
      unpricedReason: null,
    });
  }

  // Weight is only meaningful once every leg is priced, otherwise the
  // percentage silently understates the real exposure.
  if (!anyUnpriced && total.gt(0)) {
    for (const leg of legs) {
      if (leg.valueIdr === null) continue;
      leg.weightPct = new Decimal(leg.valueIdr).div(total).mul(100).toFixed(2);
    }
  }

  const stopCoverage: Record<string, string[]> = {};
  for (const stop of app.stops.list()) {
    const key = stop.pair;
    stopCoverage[key] = [...(stopCoverage[key] ?? []), stop.id];
  }

  if (anyUnpriced) {
    notes.push(
      "weightPct and totalIdr are withheld because at least one leg cannot be priced; " +
        "a zero here would read as a loss",
    );
  }

  return {
    legs: legs.sort((a, b) => {
      const left = a.valueIdr === null ? new Decimal(-1) : new Decimal(a.valueIdr);
      const right = b.valueIdr === null ? new Decimal(-1) : new Decimal(b.valueIdr);
      return right.comparedTo(left);
    }),
    totalIdr: anyUnpriced ? null : total.toString(),
    pricedLegs: legs.filter((leg) => leg.valueIdr !== null).length,
    totalLegs: legs.length,
    incomplete,
    stopCoverage,
    notes,
  };
}

const POSITIONS = defineTool(
  {
    name: "indodax_positions_live",
    title: "Live positions",
    description:
      "Read-only, needs credentials. Every non-zero holding valued in IDR at the live last price, with its share of the portfolio and which open stops already protect that leg. One call replaces recomputing positions and PnL by hand each polling round. A leg with no direct pair or no usable price reports valueIdr null and is listed in incomplete, and the weights and total are withheld when any leg is unpriced so a zero is never mistaken for a loss. Takes no arguments.",
    capability: "READ",
    riskClass: "read",
    environmentRequirement: "any",
    authRequirement: "credentials",
    destructive: false,
    idempotencyClass: "none",
    auditClass: "read",
  },
  {},
);

export function registerPositionTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool(POSITIONS);
  handlers.tools.set("indodax_positions_live", async (raw) => {
    try {
      parseArgs(POSITIONS.inputSchema, raw);
      return ok(await livePositions(app));
    } catch (error) {
      return fail(error);
    }
  });
}
