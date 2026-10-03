import Decimal from "decimal.js";
import { OrderRejectedError, ValidationError } from "@indodax-mcp/errors";
import type {
  ExecutionBackend,
  ExecutionRequest,
  ExecutionResult,
} from "@indodax-mcp/indodax-execution";
import { newOrderRecord, transition, type OrderRecord } from "@indodax-mcp/indodax-orders";

export const PAPER_TAKER_FEE = "0.0026";

export interface CostBasis {
  qty: string;
  total: string;
}

export interface PaperLedger {
  balances: Record<string, string>;
  orders: OrderRecord[];
  nextOrderId: number;
  tradeCount: number;
  totalFees: string;
  initialBalances: Record<string, string>;
  /** Average-cost basis per base asset, built from BUY fills including fees. */
  costBasis: Record<string, CostBasis>;
  /** Realized PnL in quote currency per UTC day (YYYY-MM-DD). */
  realizedByDay: Record<string, string>;
}

export function currentUtcDay(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

export function defaultLedger(): PaperLedger {
  const balances = { idr: "100000000", btc: "1" };
  return {
    balances: { ...balances },
    orders: [],
    nextOrderId: 1,
    tradeCount: 0,
    totalFees: "0",
    initialBalances: { ...balances },
    costBasis: {},
    realizedByDay: {},
  };
}

export class PaperExecutor implements ExecutionBackend {
  readonly name = "paper";

  constructor(private ledger: PaperLedger = defaultLedger()) {}

  snapshot(): PaperLedger {
    return JSON.parse(JSON.stringify(this.ledger)) as PaperLedger;
  }

  /**
   * Restart recovery: replace the in-memory ledger with a previously
   * persisted snapshot. The snapshot shape is validated defensively;
   * anything unexpected throws instead of installing corrupt state.
   */
  restore(snapshot: unknown): void {
    if (typeof snapshot !== "object" || snapshot === null) {
      throw ValidationError("paper snapshot must be an object");
    }
    const candidate = snapshot as Record<string, unknown>;
    if (
      typeof candidate.balances !== "object" ||
      candidate.balances === null ||
      !Array.isArray(candidate.orders) ||
      typeof candidate.nextOrderId !== "number" ||
      typeof candidate.tradeCount !== "number" ||
      typeof candidate.totalFees !== "string" ||
      typeof candidate.initialBalances !== "object" ||
      candidate.initialBalances === null
    ) {
      throw ValidationError("paper snapshot has an unexpected shape");
    }
    // Snapshots persisted before cost-basis tracking lack the newer books.
    const normalized = JSON.parse(JSON.stringify(candidate)) as PaperLedger;
    normalized.costBasis ??= {};
    normalized.realizedByDay ??= {};
    this.ledger = normalized;
  }

  openOrders(): OrderRecord[] {
    return this.ledger.orders.filter(
      (order) => order.state === "ACCEPTED" || order.state === "PARTIALLY_FILLED",
    );
  }

  async submit(request: ExecutionRequest): Promise<ExecutionResult> {
    const price = request.order.price === null ? null : new Decimal(request.order.price);
    if (price === null || !price.isFinite() || price.lte(0)) {
      throw ValidationError("paper needs a positive limit price");
    }
    const quantity = new Decimal(request.order.quantity);
    const notional = price.mul(quantity);
    const base = request.order.symbol.base;
    const quote = request.order.symbol.quote;

    if (request.order.side === "BUY") {
      const available = new Decimal(this.ledger.balances[quote] ?? "0");
      if (available.lt(notional)) throw OrderRejectedError("insufficient paper quote");
      this.ledger.balances[quote] = available.minus(notional).toString();
    } else {
      const available = new Decimal(this.ledger.balances[base] ?? "0");
      if (available.lt(quantity)) throw OrderRejectedError("insufficient paper base");
      this.ledger.balances[base] = available.minus(quantity).toString();
    }

    const id = `paper-${this.ledger.nextOrderId}`;
    this.ledger.nextOrderId += 1;
    this.ledger.tradeCount += 1;
    const record = newOrderRecord({
      internalOrderId: request.order.internalOrderId,
      clientOrderId: request.order.clientOrderId,
      exchangeOrderId: id,
      symbol: request.order.symbol,
      side: request.order.side,
      orderType: request.order.orderType,
      price: price.toString(),
      quantity: quantity.toString(),
      remaining: quantity.toString(),
      environment: "paper",
      tenantId: request.order.tenantId,
      exchangeAccountId: request.order.exchangeAccountId,
      strategyId: request.order.strategyId,
      runId: request.order.runId,
      riskDecisionId: null,
    });
    record.state = transition(record.state, "SUBMITTING");
    record.state = transition(record.state, "ACCEPTED");
    this.ledger.orders.push(record);
    return {
      internalOrderId: request.order.internalOrderId,
      exchangeOrderId: id,
      accepted: true,
      message: "paper open",
      executedAt: new Date().toISOString(),
    };
  }

  async cancel(internalOrderId: string): Promise<boolean> {
    const record = this.ledger.orders.find(
      (order) =>
        order.internalOrderId === internalOrderId || order.exchangeOrderId === internalOrderId,
    );
    if (!record || (record.state !== "ACCEPTED" && record.state !== "PARTIALLY_FILLED")) {
      return false;
    }
    const base = record.symbol.base;
    const quote = record.symbol.quote;
    if (record.side === "BUY") {
      const refund = new Decimal(record.price ?? "0").mul(new Decimal(record.remaining));
      const current = new Decimal(this.ledger.balances[quote] ?? "0");
      this.ledger.balances[quote] = current.plus(refund).toString();
    } else {
      const current = new Decimal(this.ledger.balances[base] ?? "0");
      this.ledger.balances[base] = current.plus(new Decimal(record.remaining)).toString();
    }
    record.state = transition(record.state, "CANCELLING");
    record.state = transition(record.state, "CANCELLED");
    record.remaining = "0";
    record.updatedAt = new Date().toISOString();
    return true;
  }

  fill(internalOrderId: string, fillPrice: string): { fee: string } {
    const price = new Decimal(fillPrice);
    if (!price.isFinite() || price.lte(0)) throw ValidationError("fill price must be positive");
    const record = this.ledger.orders.find(
      (order) =>
        order.internalOrderId === internalOrderId || order.exchangeOrderId === internalOrderId,
    );
    if (!record || (record.state !== "ACCEPTED" && record.state !== "PARTIALLY_FILLED")) {
      throw OrderRejectedError("only open paper orders can be filled");
    }
    const remaining = new Decimal(record.remaining);
    const notional = price.mul(remaining);
    const fee = notional.mul(new Decimal(PAPER_TAKER_FEE));
    const base = record.symbol.base;
    const quote = record.symbol.quote;
    if (record.side === "BUY") {
      const quoteBalance = new Decimal(this.ledger.balances[quote] ?? "0");
      if (quoteBalance.lt(fee)) throw OrderRejectedError("insufficient paper quote for fee");
      this.ledger.balances[base] = new Decimal(this.ledger.balances[base] ?? "0")
        .plus(remaining)
        .toString();
      this.ledger.balances[quote] = quoteBalance.minus(fee).toString();
      this.addBasis(base, remaining, price.mul(remaining).plus(fee));
    } else {
      const proceeds = notional.minus(fee);
      this.ledger.balances[quote] = new Decimal(this.ledger.balances[quote] ?? "0")
        .plus(proceeds)
        .toString();
      this.realizePnl(base, remaining, proceeds);
    }
    record.remaining = "0";
    record.state = transition(record.state, "FILLED");
    record.updatedAt = new Date().toISOString();
    this.ledger.totalFees = new Decimal(this.ledger.totalFees).plus(fee).toString();
    return { fee: fee.toString() };
  }

  private addBasis(asset: string, qty: Decimal, cost: Decimal): void {
    const basis = this.ledger.costBasis[asset] ?? { qty: "0", total: "0" };
    this.ledger.costBasis[asset] = {
      qty: new Decimal(basis.qty).plus(qty).toString(),
      total: new Decimal(basis.total).plus(cost).toString(),
    };
  }

  private realizePnl(asset: string, qty: Decimal, proceeds: Decimal): void {
    const basis = this.ledger.costBasis[asset] ?? { qty: "0", total: "0" };
    const basisQty = new Decimal(basis.qty);
    const consumed = basisQty.gt(0)
      ? new Decimal(basis.total).mul(Decimal.min(qty, basisQty)).div(basisQty)
      : new Decimal(0);
    this.ledger.costBasis[asset] = {
      qty: Decimal.max(0, basisQty.minus(qty)).toString(),
      total: Decimal.max(0, new Decimal(basis.total).minus(consumed)).toString(),
    };
    const realized = proceeds.minus(consumed);
    const day = currentUtcDay();
    const prior = new Decimal(this.ledger.realizedByDay[day] ?? "0");
    this.ledger.realizedByDay[day] = prior.plus(realized).toString();
  }

  topup(asset: string, amount: string): string {
    const value = new Decimal(amount);
    if (!value.isFinite() || value.lte(0)) throw ValidationError("topup amount must be positive");
    const code = asset.toLowerCase();
    const current = new Decimal(this.ledger.balances[code] ?? "0");
    const next = current.plus(value).toString();
    this.ledger.balances[code] = next;
    return next;
  }

  reset(): void {
    this.ledger = defaultLedger();
  }
}
