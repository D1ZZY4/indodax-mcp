import type Decimal from "decimal.js";
import { decimalOrNull } from "./money.js";
import type { SymbolParts } from "./asset.js";

export interface OrderInput {
  internalOrderId: string;
  clientOrderId: string;
  symbol: SymbolParts;
  side: "BUY" | "SELL";
  orderType: "LIMIT" | "MARKET";
  price: Decimal | null;
  quantity: Decimal | null;
  quoteOrderQuantity: Decimal | null;
}

export interface OrderValidation {
  ok: boolean;
  errors: string[];
}

const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,36}$/;

export function isValidClientOrderId(value: string): boolean {
  return CLIENT_ID_PATTERN.test(value);
}

export function validateOrderInput(input: OrderInput): OrderValidation {
  const errors: string[] = [];
  if (!isValidClientOrderId(input.clientOrderId)) {
    errors.push("clientOrderId must be 1-36 chars of A-Z a-z 0-9 _ -");
  }
  if (input.orderType === "LIMIT" && input.price === null) {
    errors.push("price is required for LIMIT orders");
  }
  if (input.price?.lte(0) ?? false) {
    errors.push("price must be positive");
  }
  if (input.side === "BUY" && input.orderType === "MARKET") {
    if (input.quoteOrderQuantity === null) {
      errors.push("quoteOrderQuantity is required for BUY MARKET orders");
    }
    if (input.quantity !== null) {
      errors.push("quantity and quoteOrderQuantity are mutually exclusive");
    }
  } else if (input.quantity === null) {
    errors.push("quantity is required for this order shape");
  }
  if (input.quantity?.lte(0) ?? false) {
    errors.push("quantity must be positive");
  }
  return { ok: errors.length === 0, errors };
}

export function parseDecimalField(value: unknown): Decimal | null {
  return decimalOrNull(value);
}
