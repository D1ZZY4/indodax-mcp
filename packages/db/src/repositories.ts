import { eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { auditEvents, orders, paperLedgers, tenants } from "./schema.js";
import type { alertSnapshots, stopSnapshots } from "./schema.js";

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

export interface PaperLedgerSnapshot {
  balances: Record<string, string>;
  orders: unknown[];
  nextOrderId: number;
  tradeCount: number;
  totalFees: string;
  initialBalances: Record<string, string>;
}

export class DrizzlePaperLedgerRepository {
  constructor(private readonly db: Database) {}

  async ensureTenant(name: string): Promise<string> {
    const existing = await this.db.select().from(tenants).where(eq(tenants.name, name));
    const found = existing[0]?.id;
    if (found) return found;
    const created = await this.db.insert(tenants).values({ name }).returning();
    const id = created[0]?.id;
    if (!id) throw new Error("paper tenant creation failed");
    return id;
  }

  async save(tenantId: string, snapshot: PaperLedgerSnapshot): Promise<void> {
    await this.db
      .insert(paperLedgers)
      .values({ tenantId, snapshot })
      .onConflictDoUpdate({
        target: paperLedgers.tenantId,
        set: { snapshot, updatedAt: new Date() },
      });
  }

  async load(tenantId: string): Promise<PaperLedgerSnapshot | null> {
    const rows = await this.db
      .select()
      .from(paperLedgers)
      .where(eq(paperLedgers.tenantId, tenantId));
    const snapshot = rows[0]?.snapshot as PaperLedgerSnapshot | undefined;
    return snapshot ?? null;
  }
}

export class DrizzleSnapshotRepository {
  constructor(
    private readonly db: Database,
    private readonly table: typeof alertSnapshots | typeof stopSnapshots,
  ) {}

  async save(id: string, snapshot: unknown): Promise<void> {
    await this.db
      .insert(this.table)
      .values({ id, snapshot })
      .onConflictDoUpdate({
        target: this.table.id,
        set: { snapshot, updatedAt: new Date() },
      });
  }

  async load(id: string): Promise<unknown[] | null> {
    const rows = await this.db.select().from(this.table).where(eq(this.table.id, id));
    const snapshot = rows[0]?.snapshot as unknown[] | undefined;
    return Array.isArray(snapshot) ? snapshot : null;
  }
}
