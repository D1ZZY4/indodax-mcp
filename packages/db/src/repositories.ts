import { eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { auditEvents, orders } from "./schema.js";

export interface AuditRecord {
  eventId: string;
  correlationId: string;
  kind: string;
  decision?: string | undefined;
  result?: string | undefined;
  reason?: string | undefined;
}

export class DrizzleAuditRepository {
  constructor(private readonly db: Database) {}

  async append(entry: AuditRecord): Promise<void> {
    await this.db.insert(auditEvents).values({
      eventId: entry.eventId,
      correlationId: entry.correlationId,
      kind: entry.kind,
      decision: entry.decision ?? null,
      result: entry.result ?? null,
      reason: entry.reason ?? null,
    });
  }

  async trace(correlationId: string): Promise<AuditRecord[]> {
    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.correlationId, correlationId));
    return rows.map((row) => ({
      eventId: row.eventId,
      correlationId: row.correlationId,
      kind: row.kind,
      decision: row.decision ?? undefined,
      result: row.result ?? undefined,
      reason: row.reason ?? undefined,
    }));
  }
}

export interface OrderRow {
  internalOrderId: string;
  tenantId: string;
  accountId: string;
  symbol: string;
  side: string;
  orderType: string;
  quantity: string;
  remaining: string;
  state: string;
  environment: string;
  price?: string;
  clientOrderId?: string;
}

export class DrizzleOrderRepository {
  constructor(private readonly db: Database) {}

  async insert(row: OrderRow): Promise<void> {
    await this.db.insert(orders).values({
      internalOrderId: row.internalOrderId,
      tenantId: row.tenantId,
      accountId: row.accountId,
      symbol: row.symbol,
      side: row.side,
      orderType: row.orderType,
      quantity: row.quantity,
      remaining: row.remaining,
      state: row.state,
      environment: row.environment,
      price: row.price ?? null,
      clientOrderId: row.clientOrderId ?? null,
    });
  }
}
