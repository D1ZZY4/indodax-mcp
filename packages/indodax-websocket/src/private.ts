import { z } from "zod";
import { ValidationError } from "@indodax-mcp/errors";

export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const orderUpdateSchema = z.object({
  eventType: z.literal("order_update"),
  order: z.object({
    orderId: z.string(),
    tradeId: z.string().optional(),
    symbol: z.string(),
    side: z.enum(["BUY", "SELL"]),
    origQty: z.string(),
    unfilledQty: z.string(),
    executedQty: z.string(),
    price: z.string(),
    status: z.enum(["NEW", "FILL", "DONE", "CANCELLED", "REJECTED"]),
    transactionTime: z.number(),
    clientOrderId: z.string().optional(),
    cancelReason: z.string().optional(),
    fillInformation: z
      .object({
        participant: z.enum(["MAKER", "TAKER"]),
        filledQty: z.string(),
        qty: z.string(),
        feeAsset: z.string(),
        feeRate: z.number(),
        fee: z.string(),
        taxAsset: z.string().optional(),
        taxRate: z.number().optional(),
        tax: z.string().optional(),
        clearingAsset: z.string().optional(),
        clearingRate: z.number().optional(),
        clearing: z.string().optional(),
      })
      .optional(),
  }),
});

export type OrderUpdate = z.infer<typeof orderUpdateSchema>;

export function parseOrderUpdate(data: unknown): OrderUpdate {
  const parsed = orderUpdateSchema.safeParse(data);
  if (!parsed.success) throw ValidationError("invalid order_update payload");
  return parsed.data;
}

export function isStpCancellation(update: OrderUpdate): boolean {
  return update.order.cancelReason === "SELF_TRADE_PREVENTION";
}

export function tokenExpired(nowMs: number, issuedAtMs: number): boolean {
  return nowMs - issuedAtMs >= TOKEN_TTL_MS;
}
