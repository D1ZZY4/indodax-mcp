import type Decimal from "decimal.js";
import { decimalOrNull } from "@d1zzy4-jethools/core";

/**
 * Advisory budget sizing for order validation responses.
 *
 * The risk engine stays budget-ignorant by design: it enforces deterministic
 * limits, not per-operator position sizing. Two different questions share one
 * budget, and mixing them caused warning fatigue on small accounts, where
 * every placeable order is several multiples of a 1% budget by construction:
 *
 * - size multiple (notional divided by budget) is sizing information. It is
 *   always reported and never warns, because a multiple above 1 is normal
 *   rather than dangerous;
 * - risk multiple (stop distance times quantity divided by budget) is the
 *   actual maximum loss versus budget. Only this one warns, and only above 1.
 *
 * Neither ever changes ALLOW/DENY/HALT; they only add numbers the harness
 * can branch on.
 */

export interface BudgetSizing {
  /** Echo of the supplied budget, or null when none was given. */
  riskBudget: string | null;
  /** Notional divided by budget, 2 decimals, informational only. */
  notionalMultiple: number | null;
}

export interface StopRisk {
  /** Planned loss if the stop fills at its trigger, in quote units. */
  riskAmount: string | null;
  /** Risk amount divided by budget, 2 decimals. */
  riskMultiple: number | null;
  /** Present when the stop-based multiple exceeds 1. */
  riskWarning: string | null;
  /** Guidance when no stop price was supplied for a real-risk assessment. */
  riskNote: string | null;
}

/**
 * Compare a hypothetical notional against an optional operator budget.
 *
 * A null notional (unpriced MARKET shape) or an absent budget yields nulls
 * rather than a fabricated multiple of zero.
 */
export function assessBudgetSize(
  notional: Decimal | null,
  budget: number | undefined,
): BudgetSizing {
  if (budget === undefined) return { riskBudget: null, notionalMultiple: null };
  const budgetDec = decimalOrNull(budget);
  if (budgetDec === null || !budgetDec.gt(0) || notional === null || !notional.isFinite()) {
    return { riskBudget: String(budget), notionalMultiple: null };
  }
  const multiple = Number(notional.div(budgetDec).toFixed(2));
  return {
    riskBudget: budgetDec.toString(),
    notionalMultiple: Number.isFinite(multiple) ? multiple : null,
  };
}

/**
 * Compare the planned stop loss against an optional operator budget.
 *
 * Needs the order price, the stop trigger, the quantity, and the budget.
 * Anything missing yields nulls with guidance instead of a guess.
 */
export function assessStopRisk(input: {
  price: Decimal | null;
  stopPrice: number | undefined;
  quantity: Decimal | null;
  budget: number | undefined;
}): StopRisk {
  const none: StopRisk = {
    riskAmount: null,
    riskMultiple: null,
    riskWarning: null,
    riskNote: null,
  };
  if (input.budget === undefined) return none;
  const budgetDec = decimalOrNull(input.budget);
  if (budgetDec === null || !budgetDec.gt(0)) {
    return { ...none, riskNote: "riskBudget must be positive to assess stop risk" };
  }
  if (input.stopPrice === undefined) {
    return {
      ...none,
      riskNote:
        "pass stopPrice for a real-risk assessment (stop distance times quantity over budget); " +
        "the notional multiple above is sizing info only",
    };
  }
  const stop = decimalOrNull(input.stopPrice);
  if (
    input.price === null ||
    !input.price.isFinite() ||
    stop === null ||
    input.quantity === null ||
    !input.quantity.isFinite()
  ) {
    return { ...none, riskNote: "need a priced order with quantity to assess stop risk" };
  }
  const riskAmount = input.price.minus(stop).abs().mul(input.quantity);
  if (!riskAmount.isFinite()) return none;
  const multiple = Number(riskAmount.div(budgetDec).toFixed(2));
  if (!Number.isFinite(multiple)) return { ...none, riskAmount: riskAmount.toString() };
  if (multiple <= 1) {
    return {
      riskAmount: riskAmount.toString(),
      riskMultiple: multiple,
      riskWarning: null,
      riskNote: null,
    };
  }
  return {
    riskAmount: riskAmount.toString(),
    riskMultiple: multiple,
    riskWarning:
      `planned loss ${riskAmount.toString()} is ${multiple}x your risk budget ` +
      `${budgetDec.toString()} at this stop distance; tighten the stop or lower the quantity`,
    riskNote: null,
  };
}
