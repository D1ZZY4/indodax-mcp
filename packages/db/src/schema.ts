import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const exchangeAccounts = pgTable(
  "exchange_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    label: text("label").notNull(),
    keyFingerprint: text("key_fingerprint").notNull(),
    canTrade: boolean("can_trade").default(false).notNull(),
    canWithdraw: boolean("can_withdraw").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("exchange_accounts_tenant_idx").on(table.tenantId)],
);

export const balances = pgTable(
  "balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => exchangeAccounts.id),
    asset: text("asset").notNull(),
    free: numeric("free", { precision: 36, scale: 18 }).notNull(),
    locked: numeric("locked", { precision: 36, scale: 18 }).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("balances_account_idx").on(table.accountId),
    uniqueIndex("balances_account_asset_uidx").on(table.accountId, table.asset),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    internalOrderId: text("internal_order_id").notNull(),
    exchangeOrderId: text("exchange_order_id"),
    clientOrderId: text("client_order_id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => exchangeAccounts.id),
    symbol: text("symbol").notNull(),
    side: text("side").notNull(),
    orderType: text("order_type").notNull(),
    price: numeric("price", { precision: 36, scale: 18 }),
    quantity: numeric("quantity", { precision: 36, scale: 18 }).notNull(),
    remaining: numeric("remaining", { precision: 36, scale: 18 }).notNull(),
    state: text("state").notNull(),
    environment: text("environment").notNull(),
    strategyId: text("strategy_id"),
    runId: text("run_id"),
    riskDecisionId: text("risk_decision_id"),
    reconciliationState: text("reconciliation_state").default("UNKNOWN").notNull(),
    rawMetadata: jsonb("raw_metadata"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("orders_internal_id_uidx").on(table.tenantId, table.internalOrderId),
    uniqueIndex("orders_client_id_uidx").on(table.tenantId, table.clientOrderId),
    index("orders_account_idx").on(table.accountId),
    index("orders_state_idx").on(table.state),
  ],
);

export const orderEvents = pgTable(
  "order_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    eventId: text("event_id").notNull(),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("order_events_event_uidx").on(table.eventId),
    index("order_events_order_idx").on(table.orderId),
  ],
);

export const fills = pgTable(
  "fills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    tradeId: text("trade_id"),
    price: numeric("price", { precision: 36, scale: 18 }).notNull(),
    quantity: numeric("quantity", { precision: 36, scale: 18 }).notNull(),
    fee: numeric("fee", { precision: 36, scale: 18 }).notNull(),
    feeAsset: text("fee_asset").notNull(),
    tax: numeric("tax", { precision: 36, scale: 18 }).default("0").notNull(),
    clearing: numeric("clearing", { precision: 36, scale: 18 }).default("0").notNull(),
    isMaker: boolean("is_maker"),
    executedAt: timestamp("executed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("fills_trade_uidx").on(table.tradeId),
    index("fills_order_idx").on(table.orderId),
  ],
);

export const positions = pgTable(
  "positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    asset: text("asset").notNull(),
    current: numeric("current", { precision: 36, scale: 18 }).notNull(),
    initial: numeric("initial", { precision: 36, scale: 18 }).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("positions_tenant_idx").on(table.tenantId),
    uniqueIndex("positions_tenant_asset_uidx").on(table.tenantId, table.asset),
  ],
);

export const portfolioSnapshots = pgTable("portfolio_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  equity: numeric("equity", { precision: 36, scale: 18 }).notNull(),
  currency: text("currency").default("IDR").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
});

export const riskEvents = pgTable(
  "risk_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    correlationId: text("correlation_id").notNull(),
    outcome: text("outcome").notNull(),
    reasons: jsonb("reasons").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("risk_events_corr_idx").on(table.correlationId)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: text("event_id").notNull(),
    correlationId: text("correlation_id").notNull(),
    kind: text("kind").notNull(),
    decision: text("decision"),
    result: text("result"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("audit_events_event_uidx").on(table.eventId),
    index("audit_events_corr_idx").on(table.correlationId),
  ],
);

export const strategyDefinitions = pgTable("strategy_definitions", {
  id: text("id").primaryKey(),
  description: text("description").notNull(),
  parameters: jsonb("parameters").notNull(),
});

export const strategyRuns = pgTable(
  "strategy_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    strategyId: text("strategy_id")
      .notNull()
      .references(() => strategyDefinitions.id),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  },
  (table) => [index("strategy_runs_strategy_idx").on(table.strategyId)],
);

export const backtestRuns = pgTable("backtest_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  strategyId: text("strategy_id").notNull(),
  report: jsonb("report").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const reconciliationTasks = pgTable("reconciliation_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").references(() => orders.id),
  reason: text("reason").notNull(),
  status: text("status").default("open").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const reconciliationResults = pgTable("reconciliation_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").references(() => reconciliationTasks.id),
  state: text("state").notNull(),
  detail: jsonb("detail").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const websocketOffsets = pgTable(
  "websocket_offsets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: text("scope").notNull(),
    channel: text("channel").notNull(),
    offset: integer("offset").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("websocket_offsets_scope_uidx").on(table.scope, table.channel)],
);

export const deadmanState = pgTable(
  "deadman_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    state: text("state").notNull(),
    pairs: jsonb("pairs").notNull(),
    countdownMs: integer("countdown_ms"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("deadman_state_tenant_uidx").on(table.tenantId)],
);

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    pair: text("pair").notNull(),
    condition: jsonb("condition").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("alerts_tenant_idx").on(table.tenantId)],
);

export const systemEvents = pgTable("system_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    scope: text("scope").notNull(),
    responseHash: text("response_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("idempotency_scope_key_uidx").on(table.scope, table.key)],
);

export const paperLedgers = pgTable(
  "paper_ledgers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    snapshot: jsonb("snapshot").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("paper_ledgers_tenant_uidx").on(table.tenantId)],
);
