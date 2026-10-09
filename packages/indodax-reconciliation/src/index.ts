import Decimal from "decimal.js";
import type { ReconciliationState } from "@d1zzy4-jethools/core";
import { compareBalance, compareOrderIds } from "@d1zzy4-jethools/indodax-orders";

export interface LocalOrderView {
  internalOrderId: string;
  exchangeOrderId: string | null;
  state: string;
}

export interface ExchangeOrderView {
  exchangeOrderId: string;
  state: string;
}

export interface LocalFillView {
  exchangeOrderId: string;
  quantity: string;
}

export interface ExchangeFillView {
  exchangeOrderId: string;
  quantity: string;
}

export interface ReconciliationReport {
  orders: ReturnType<typeof compareOrderIds>;
  fills: { state: ReconciliationState; checked: number; mismatched: string[] };
  balances: { asset: string; state: ReconciliationState }[];
  overall: ReconciliationState;
}

export function reconcileFills(
  local: LocalFillView[],
  exchange: ExchangeFillView[],
): {
  state: ReconciliationState;
  checked: number;
  mismatched: string[];
  exchangeOnly: string[];
} {
  const byOrder = new Map<string, Decimal>();
  for (const fill of exchange) {
    const current = byOrder.get(fill.exchangeOrderId) ?? new Decimal(0);
    byOrder.set(fill.exchangeOrderId, current.plus(new Decimal(fill.quantity)));
  }
  const localIds = new Set(local.map((fill) => fill.exchangeOrderId));
  const mismatched: string[] = [];
  for (const fill of local) {
    const expected = byOrder.get(fill.exchangeOrderId);
    if (!expected?.eq(new Decimal(fill.quantity))) {
      mismatched.push(fill.exchangeOrderId);
    }
  }
  const exchangeOnly = [...byOrder.keys()].filter((id) => !localIds.has(id));
  const state = mismatched.length === 0 && exchangeOnly.length === 0 ? "MATCH" : "MISMATCH";
  return { state, checked: local.length, mismatched, exchangeOnly };
}

export function reconcileAll(input: {
  localOrders: LocalOrderView[];
  exchangeOrders: ExchangeOrderView[];
  localFills: LocalFillView[];
  exchangeFills: ExchangeFillView[];
  balances: { asset: string; local: string; exchange: string; tolerance: string }[];
}): ReconciliationReport {
  const openLocal = input.localOrders
    .filter((order) => ["ACCEPTED", "PARTIALLY_FILLED"].includes(order.state))
    .map((order) => order.exchangeOrderId ?? order.internalOrderId);
  const orders = compareOrderIds(
    openLocal,
    input.exchangeOrders.map((order) => order.exchangeOrderId),
  );
  const fills = reconcileFills(input.localFills, input.exchangeFills);
  const balances = input.balances.map((balance) => ({
    asset: balance.asset,
    state: compareBalance(
      new Decimal(balance.local),
      new Decimal(balance.exchange),
      new Decimal(balance.tolerance),
    ),
  }));
  const states = [orders.state, fills.state, ...balances.map((balance) => balance.state)];
  const overall: ReconciliationState = states.includes("MISMATCH")
    ? "MISMATCH"
    : states.includes("UNKNOWN")
      ? "UNKNOWN"
      : "MATCH";
  return { orders, fills, balances, overall };
}
