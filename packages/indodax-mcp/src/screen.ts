import type Decimal from "decimal.js";
import { decimalOrNull } from "@d1zzy4-jethools/core";

/**
 * Screening-ready derived fields for bulk ticker rows.
 *
 * An autonomous harness screens hundreds of pairs per loop by 24h range,
 * position inside the range, spread, and quote volume. Deriving those four
 * numbers per row on the harness means parsing the same decimal strings the
 * server already holds, once per candidate, with a fresh chance to divide by
 * zero or parse a missing field into NaN on every pass. Computing them once
 * here keeps one decimal implementation and one set of edge rules.
 */

export interface ScreenedValues {
  /** 24h range as percent of the low, 1 decimal, or null when unusable. */
  rangePct: number | null;
  /** Position of last inside high/low, 0 to 1 with 2 decimals, or null. */
  pos: number | null;
  /** Spread as percent of the bid, 2 decimals, or null. */
  spreadPct: number | null;
}

function num(value: Decimal, decimals: number): number | null {
  if (!value.isFinite()) return null;
  const rounded = Number(value.toFixed(decimals));
  return Number.isFinite(rounded) ? rounded : null;
}

function decOf(body: Record<string, unknown>, key: string): Decimal | null {
  const raw = body[key];
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  return decimalOrNull(raw);
}

/** Derive range, position, and spread from a raw bulk ticker body. */
export function screenValues(body: Record<string, unknown>): ScreenedValues {
  const high = decOf(body, "high");
  const low = decOf(body, "low");
  const last = decOf(body, "last");
  const buy = decOf(body, "buy");
  const sell = decOf(body, "sell");
  let rangePct: number | null = null;
  let pos: number | null = null;
  if (high === null || low === null) return { rangePct, pos, spreadPct: spreadPctFrom(buy, sell) };
  if (low.gt(0) && high.gt(low)) {
    rangePct = num(high.minus(low).div(low).mul(100), 1);
    if (last !== null) {
      const ratio = last.minus(low).div(high.minus(low));
      pos = num(ratio, 2);
    }
  }
  return { rangePct, pos, spreadPct: spreadPctFrom(buy, sell) };
}

function spreadPctFrom(buy: Decimal | null, sell: Decimal | null): number | null {
  if (buy === null || sell === null) return null;
  if (!buy.gt(0)) return null;
  return num(sell.minus(buy).div(buy).mul(100), 2);
}

export interface ScreenFilters {
  minVolumeIdr?: number | undefined;
  minRangePct?: number | undefined;
  maxSpreadPct?: number | undefined;
  minPos?: number | undefined;
  maxPos?: number | undefined;
}

/**
 * Whether a raw bulk ticker body passes the screening filters.
 *
 * Every bound is opt-in. A row that cannot produce the needed value (no
 * volume, no usable high/low, no usable bid) fails an active bound rather
 * than passing silently, so a filtered scan never hides a thin market as a
 * candidate.
 */
export function passesScreen(body: Record<string, unknown>, filters: ScreenFilters): boolean {
  if (filters.minVolumeIdr !== undefined) {
    const volume = decOf(body, "vol_idr");
    if (volume === null || !volume.gte(filters.minVolumeIdr)) return false;
  }
  const screened = screenValues(body);
  if (filters.minRangePct !== undefined) {
    if (screened.rangePct === null || screened.rangePct < filters.minRangePct) return false;
  }
  if (filters.maxSpreadPct !== undefined) {
    if (screened.spreadPct === null || screened.spreadPct > filters.maxSpreadPct) return false;
  }
  if (filters.minPos !== undefined) {
    if (screened.pos === null || screened.pos < filters.minPos) return false;
  }
  if (filters.maxPos !== undefined) {
    if (screened.pos === null || screened.pos > filters.maxPos) return false;
  }
  return true;
}

export interface FlowSummary {
  buyCount: number;
  sellCount: number;
  /** Share of buys in sampled trades, 0 to 1 with 3 decimals. Null when empty. */
  buyRatio: number | null;
  /** Present when one side dominates the sample (below 0.2 or above 0.8). */
  flowWarning: string | null;
}

/**
 * Taker-flow summary for a page of public trades.
 *
 * A loop that fetches 100 trades per candidate and counts sides by hand pays
 * the full context cost plus a manual loop per pair. One summary answers the
 * only question screening asks: is this tape one-sided. Ratios on samples
 * below 10 trades stay unflagged because a thin sample cannot carry that
 * verdict.
 */
export function flowOf(types: ("buy" | "sell")[]): FlowSummary {
  const buyCount = types.filter((side) => side === "buy").length;
  const sellCount = types.length - buyCount;
  if (types.length === 0) return { buyCount: 0, sellCount: 0, buyRatio: null, flowWarning: null };
  const buyRatio = Math.round((buyCount / types.length) * 1000) / 1000;
  let flowWarning: string | null = null;
  if (types.length >= 10 && buyRatio < 0.2) {
    flowWarning = `seller-dominated tape: ${buyCount} buys of ${types.length} sampled trades`;
  } else if (types.length >= 10 && buyRatio > 0.8) {
    flowWarning = `buyer-dominated tape: ${buyCount} buys of ${types.length} sampled trades`;
  }
  return { buyCount, sellCount, buyRatio, flowWarning };
}

/**
 * Explain an unreadable orderbook as an unavailable market.
 *
 * A delisted or halted pair answers depth with a shape that has no bid/ask
 * arrays, which surfaces as a raw shape error naming array paths. That text
 * invites a retry of a market that cannot trade. Name the pair, the likely
 * cause, and the verification step instead.
 */
export function pairUnavailableMessage(pair: string, cause: string): string {
  return (
    `PAIR_UNAVAILABLE: no usable orderbook for ${pair} (${cause.slice(0, 120)}). ` +
    "The market may be delisted, suspended, or too thin to quote. " +
    "Verify with indodax_search_symbols and check tradable on indodax_pairs " +
    "before retrying; do not treat this as a transient network failure."
  );
}
