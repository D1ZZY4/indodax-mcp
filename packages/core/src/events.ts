export type DomainEvent =
  | { kind: "order.submitting"; orderId: string; at: string }
  | { kind: "order.accepted"; orderId: string; exchangeOrderId: string; at: string }
  | { kind: "order.rejected"; orderId: string; reason: string; at: string }
  | { kind: "order.fill"; orderId: string; quantity: string; price: string; at: string }
  | { kind: "order.cancelled"; orderId: string; at: string }
  | { kind: "order.unknown"; orderId: string; at: string }
  | { kind: "order.reconciled"; orderId: string; state: string; at: string }
  | { kind: "risk.allowed"; correlationId: string; at: string }
  | { kind: "risk.denied"; correlationId: string; reason: string; at: string }
  | { kind: "websocket.connected"; scope: string; at: string }
  | { kind: "websocket.disconnected"; scope: string; reason: string; at: string }
  | { kind: "websocket.recovered"; scope: string; offset: number; at: string }
  | { kind: "deadman.armed"; pairs: string[]; at: string }
  | { kind: "deadman.refreshed"; pairs: string[]; at: string }
  | { kind: "deadman.expired"; pairs: string[]; at: string }
  | { kind: "account.synced"; accountId: string; at: string }
  | { kind: "portfolio.updated"; accountId: string; equity: string; at: string };
