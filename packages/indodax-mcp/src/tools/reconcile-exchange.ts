import { z } from "zod";
import Decimal from "decimal.js";
import { compareBalance } from "@indodax-mcp/indodax-orders";
import { reconcileFills } from "@indodax-mcp/indodax-reconciliation";
import type { AppServices } from "../composition.js";

export interface BalanceRow {
  asset: string;
  state: string;
  paper: string;
  exchange: string;
  tolerance: string;
  difference: string;
}

export interface UnknownLeg {
  leg: string;
  reason: string;
}

/** Exchange-leg failure reason for reports. Truncated message only, never credentials. */
function legReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 200);
}

const exchangeOrderSchema = z
  .object({
    orderId: z.union([z.string(), z.number()]).optional(),
    fullOrderId: z.string().optional(),
  })
  .passthrough();

const exchangeTradeSchema = z
  .object({
    orderId: z.string().optional(),
    qty: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

/**
 * Local paper fills expressed as filled quantities per exchange order id.
 * The paper executor zeroes `remaining` on a fill, so the filled quantity is
 * quantity minus remaining rather than the quantity field alone.
 */
export function localPaperFills(app: AppServices): {
  exchangeOrderId: string;
  quantity: string;
}[] {
  return app.paper
    .snapshot()
    .orders.filter((order) => order.state === "FILLED")
    .map((order) => ({
      exchangeOrderId: order.exchangeOrderId ?? order.internalOrderId,
      quantity: new Decimal(order.quantity).minus(new Decimal(order.remaining)).toString(),
    }));
}

export interface ExchangeLegs {
  openOrders: { exchangeOrderId: string; state: string }[];
  fills: { state: string; checked: number; exchangeOnly: string[] };
  balances: BalanceRow[];
  unknownLegs: UnknownLeg[];
  observed: "MATCH" | "UNKNOWN";
  observedReasons: string[];
}

/**
 * Read every requested exchange leg.
 *
 * A leg that fails is recorded in `unknownLegs` with its reason instead of
 * failing the whole report, and the overall observation becomes UNKNOWN. The
 * caller therefore never receives a MATCH that was only inferred from legs
 * that could not be read.
 */
export async function readExchangeLegs(
  app: AppServices,
  symbol: string | undefined,
  tolerance: Decimal,
): Promise<ExchangeLegs> {
  const account = app.accountClient;
  if (!account) throw new Error("exchange legs require an authenticated account client");
  const unknownLegs: UnknownLeg[] = [];

  let openOrders: { exchangeOrderId: string; state: string }[] = [];
  try {
    const rawOrders = await account.openOrders(symbol);
    if (!Array.isArray(rawOrders)) throw new Error("unexpected openOrders shape");
    openOrders = rawOrders.map((item, index) => {
      const parsed = exchangeOrderSchema.safeParse(item);
      const id = parsed.success
        ? String(parsed.data.orderId ?? parsed.data.fullOrderId ?? `unknown-${index}`)
        : `unknown-${index}`;
      return { exchangeOrderId: id, state: "OPEN" };
    });
  } catch (error) {
    unknownLegs.push({ leg: "openOrders", reason: legReason(error) });
  }

  let exchangeFills: { exchangeOrderId: string; quantity: string }[] = [];
  if (symbol !== undefined) {
    try {
      const trades = (await account.myTrades({ symbol })) as { data?: unknown };
      const list = Array.isArray(trades?.data) ? (trades?.data as unknown[]) : null;
      if (!list) throw new Error("unexpected myTrades shape");
      exchangeFills = list.map((item, index) => {
        const parsed = exchangeTradeSchema.safeParse(item);
        return {
          exchangeOrderId:
            parsed.success && parsed.data.orderId ? parsed.data.orderId : `unknown-${index}`,
          quantity: parsed.success && parsed.data.qty !== undefined ? String(parsed.data.qty) : "0",
        };
      });
    } catch (error) {
      unknownLegs.push({ leg: "myTrades", reason: legReason(error) });
    }
  }

  const fills = reconcileFills(localPaperFills(app), exchangeFills);

  let balances: BalanceRow[] = [];
  try {
    const info = await account.getAccount();
    app.accountSyncedAt = Date.now();
    const ledger = app.paper.snapshot();
    balances = info.balances.map((balance) => {
      const asset = balance.asset.toLowerCase();
      const paperValue = new Decimal(ledger.balances[asset] ?? "0");
      const exchangeValue = new Decimal(balance.free).plus(new Decimal(balance.locked));
      return {
        asset,
        state: compareBalance(paperValue, exchangeValue, tolerance),
        paper: paperValue.toString(),
        exchange: exchangeValue.toString(),
        tolerance: tolerance.toString(),
        difference: paperValue.minus(exchangeValue).abs().toString(),
      };
    });
  } catch (error) {
    unknownLegs.push({ leg: "account", reason: legReason(error) });
  }

  const observed = unknownLegs.length > 0 ? "UNKNOWN" : "MATCH";
  const observedReasons =
    unknownLegs.length > 0
      ? unknownLegs.map((issue) => `${issue.leg} unread: ${issue.reason}`)
      : ["all requested exchange legs read: openOrders, fills, balances"];
  return {
    openOrders,
    fills: { state: fills.state, checked: fills.checked, exchangeOnly: fills.exchangeOnly },
    balances,
    unknownLegs,
    observed,
    observedReasons,
  };
}

/**
 * Cross-ledger balance rows for the credentials-only balance comparison.
 *
 * Paper and exchange are separate ledgers that never settle against each
 * other, so a MISMATCH row here is observational rather than a fault.
 */
export function balanceRows(
  ledgerBalances: Record<string, string>,
  balances: { asset: string; free: string; locked: string }[],
  tolerance: Decimal,
): BalanceRow[] {
  return balances.map((balance) => {
    const asset = balance.asset.toLowerCase();
    const paperValue = new Decimal(ledgerBalances[asset] ?? "0");
    const exchangeValue = new Decimal(balance.free).plus(new Decimal(balance.locked));
    return {
      asset,
      state: compareBalance(paperValue, exchangeValue, tolerance),
      paper: paperValue.toString(),
      exchange: exchangeValue.toString(),
      tolerance: tolerance.toString(),
      difference: paperValue.minus(exchangeValue).abs().toString(),
    };
  });
}
