import type Decimal from "decimal.js";
import { decimalOrNull } from "@indodax-mcp/core";

/**
 * Advisory risk-budget assessment for order validation responses.
 *
 * The risk engine stays budget-ignorant by design: it enforces deterministic
 * limits, not per-operator position sizing. A proposal for 1 unit of an asset
 * at 9x the operator budget still returns ALLOW when every limit passes, and
 * a harness reading only the verdict sizes blindly. This helper answers the
 * question the verdict does not ask: how big is this order next to my budget.
 * It never changes ALLOW/DENY/HALT; it only adds numbers and a warning the
 * harness can branch on.
 */

export interface RiskBudgetAssessment {
  /** Echo of the supplied budget, or null when none was given. */
  riskBudget: string | null;
  /** Notional divided by budget, 2 decimals, or null when not assessable. */
  riskMultiple: number | null;
  /** Present when the multiple exceeds 1. */
  riskWarning: string | null;
}

/**
 * Compare a hypothetical notional against an optional operator budget.
 *
 * A null notional (unpriced MARKET shape) or an absent budget yields nulls
 * rather than a fabricated multiple of zero.
 */
export function assessRiskBudget(
  notional: Decimal | null,
  budget: number | undefined,
): RiskBudgetAssessment {
  if (budget === undefined) return { riskBudget: null, riskMultiple: null, riskWarning: null };
  const budgetDec = decimalOrNull(budget);
  if (budgetDec === null || !budgetDec.gt(0) || notional === null || !notional.isFinite()) {
    return { riskBudget: String(budget), riskMultiple: null, riskWarning: null };
  }
  const multiple = Number(notional.div(budgetDec).toFixed(2));
  if (!Number.isFinite(multiple) || multiple <= 1) {
    return { riskBudget: budgetDec.toString(), riskMultiple: multiple, riskWarning: null };
  }
  return {
    riskBudget: budgetDec.toString(),
    riskMultiple: multiple,
    riskWarning:
      `notional ${notional.toString()} is ${multiple}x your risk budget ` +
      `${budgetDec.toString()}; lower the quantity or split the order before placing`,
  };
}
