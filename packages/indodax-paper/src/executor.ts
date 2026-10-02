import Decimal from "decimal.js";
import { OrderRejectedError, ValidationError } from "@indodax-mcp/errors";
import type {
  ExecutionBackend,
  ExecutionRequest,
  ExecutionResult,
} from "@indodax-mcp/indodax-execution";
import { newOrderRecord, transition, type OrderRecord } from "@indodax-mcp/indodax-orders";

export const PAPER_TAKER_FEE = "0.0026";

export interface PaperLedger {
  balances: Record<string, string>;
  orders: OrderRecord[];
  nextOrderId: number;
  tradeCount: number;
  totalFees: string;
  initialBalances: Record<string, string>;
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
  };
}

export class PaperExecutor implements ExecutionBackend {
  readonly name = "paper";

  constructor(private ledger: PaperLedger = defaultLedger()) {}

  snapshot(): PaperLedger {
    return JSON.parse(JSON.stringify(this.ledger)) as PaperLedger;
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
    const record = this.ledger.orders.find((order) => order.internalOrderId === internalOrderId);
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
    const record = this.ledger.orders.find((order) => order.internalOrderId === internalOrderId);
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
    } else {
      this.ledger.balances[quote] = new Decimal(this.ledger.balances[quote] ?? "0")
        .plus(notional.minus(fee))
        .toString();
    }
    record.remaining = "0";
    record.state = transition(record.state, "FILLED");
    record.updatedAt = new Date().toISOString();
    this.ledger.totalFees = new Decimal(this.ledger.totalFees).plus(fee).toString();
    return { fee: fee.toString() };
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
