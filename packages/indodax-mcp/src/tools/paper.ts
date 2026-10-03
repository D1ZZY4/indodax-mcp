import { z } from "zod";
import Decimal from "decimal.js";
import { RiskDeniedError, ValidationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { parseSymbolFlexible } from "@indodax-mcp/core";
import { ExecutionService } from "@indodax-mcp/indodax-execution";
import { fail, ok, parseArgs } from "../respond.js";
import { clientOrderIdArg, pairArg, priceArg, quantityArg, sideArg } from "../schemas.js";
import { resolveRiskContext } from "../risk-context.js";
import type { AppServices } from "../composition.js";

const PAPER = {
  capability: "PAPER" as const,
  riskClass: "mutation" as const,
  environmentRequirement: "paper" as const,
  authRequirement: "none" as const,
  destructive: false,
  idempotencyClass: "client-key" as const,
  auditClass: "mutation" as const,
};

const PAPER_READ = { ...PAPER, riskClass: "read" as const, auditClass: "read" as const };

export interface PaperPlacement {
  pair: string;
  side: "BUY" | "SELL";
  orderType?: "LIMIT" | "MARKET" | undefined;
  price?: number | undefined;
  quantity: number;
  clientOrderId?: string | undefined;
}

export async function placePaperOrder(app: AppServices, placement: PaperPlacement) {
  if (placement.clientOrderId !== undefined && placement.clientOrderId !== "") {
    const replay = app.paper.replayResult(placement.clientOrderId);
    if (replay) return replay;
  }
  const symbol = parseSymbolFlexible(placement.pair);
  if (!symbol) throw ValidationError(`invalid pair: ${placement.pair}`);
  if (app.deadman.shouldHaltLiveTrading()) {
    throw RiskDeniedError(`deadman ${app.deadman.snapshot().state} halts trading`);
  }
  const orderType = placement.orderType ?? "LIMIT";
  const price = placement.price === undefined ? null : new Decimal(placement.price);
  const quantity = new Decimal(placement.quantity);
  const notional = price === null ? null : price.mul(quantity);
  const ledger = app.paper.snapshot();
  const intent = {
    agentId: "mcp",
    sessionId: `mcp-${Date.now().toString(36)}`,
    symbol,
    side: placement.side,
    orderType,
    price: price?.toString() ?? null,
    quantityOrIdr: quantity.toString(),
    quantityIsIdr: false,
    mode: "paper" as const,
    capability: "PAPER" as const,
    reason: "paper_order",
  };
  const proposal = app.trading.propose(intent);
  const order = app.trading.toOrder(proposal, {
    tenantId: app.tenantId,
    exchangeAccountId: app.accountId,
  });
  const decision = app.trading.review(
    order,
    await resolveRiskContext(app, {
      mode: "paper",
      capability: "PAPER",
      pair: placement.pair,
      clientOrderId: placement.clientOrderId ?? order.clientOrderId,
      balanceSufficient: hasPaperBalance(
        ledger.balances,
        symbol,
        placement.side,
        notional,
        quantity,
      ),
    }),
  );
  if (decision.outcome !== "ALLOW") throw RiskDeniedError(decision.message);
  const execution = new ExecutionService(app.paper);
  const result = await execution.execute(
    {
      order,
      mode: "paper",
      capability: "PAPER",
      correlationId: proposal.correlationId,
      requestedAt: new Date().toISOString(),
    },
    decision,
  );
  if (placement.clientOrderId !== undefined && placement.clientOrderId !== "") {
    app.paper.rememberResult(placement.clientOrderId, result);
  }
  return result;
}

function hasPaperBalance(
  balances: Record<string, string>,
  symbol: { base: string; quote: string },
  side: "BUY" | "SELL",
  notional: Decimal | null,
  quantity: Decimal,
): boolean | null {
  try {
    if (side === "BUY") {
      if (notional === null) return null;
      return new Decimal(balances[symbol.quote] ?? "0").gte(notional);
    }
    return new Decimal(balances[symbol.base] ?? "0").gte(quantity);
  } catch {
    return null;
  }
}

export function registerPaperTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  const defs = [
    {
      name: "indodax_paper_account",
      description: "Read-only. Virtual paper balances. Never touches real money.",
    },
    {
      name: "indodax_paper_status",
      description: "Read-only. Paper trade count, open orders, and total fees.",
    },
    {
      name: "indodax_paper_orders",
      description: "Read-only. List open paper orders.",
    },
    {
      name: "indodax_paper_snapshots",
      description: "Read-only. Full paper ledger snapshot for debugging.",
    },
  ];
  for (const def of defs) {
    registry.registerTool({
      metadata: { name: def.name, title: def.name, description: def.description, ...PAPER_READ },
      inputSchema: z.object({}),
    });
  }
  registry.registerTool({
    metadata: {
      name: "indodax_paper_order",
      title: "Paper order",
      description:
        "Simulated execution through validation and risk. Args: pair, side, price, quantity, optional clientOrderId for idempotent replay. Returns the open paper order id.",
      ...PAPER,
    },
    inputSchema: z.object({
      pair: pairArg,
      side: sideArg,
      price: priceArg,
      quantity: quantityArg,
      clientOrderId: clientOrderIdArg,
    }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_paper_fill",
      title: "Paper fill",
      description:
        "Simulated execution. Fill one open paper order with fees. Args: orderId, price.",
      ...PAPER,
    },
    inputSchema: z.object({ orderId: z.string().min(1), price: z.number().positive() }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_paper_cancel",
      title: "Paper cancel",
      description: "Simulated execution. Cancel one open paper order with refund. Args: orderId.",
      ...PAPER,
    },
    inputSchema: z.object({ orderId: z.string().min(1) }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_paper_reset",
      title: "Paper reset",
      description:
        "Simulated, destructive to simulation only. Reset balances and clear orders. Never touches real money.",
      ...PAPER,
      destructive: true,
    },
    inputSchema: z.object({}),
  });

  handlers.tools.set("indodax_paper_account", async () => ok(app.paper.snapshot().balances));
  handlers.tools.set("indodax_paper_status", async () => {
    const snapshot = app.paper.snapshot();
    return ok({
      tradeCount: snapshot.tradeCount,
      openOrders: snapshot.orders.filter((order) => order.state === "ACCEPTED").length,
      totalFees: snapshot.totalFees,
    });
  });
  handlers.tools.set("indodax_paper_orders", async () => ok(app.paper.openOrders()));
  handlers.tools.set("indodax_paper_snapshots", async () => ok(app.paper.snapshot()));
  handlers.tools.set("indodax_paper_reset", async () => {
    app.paper.reset();
    return ok({ status: "reset" });
  });

  handlers.tools.set("indodax_paper_order", async (raw) => {
    try {
      const args = parseArgs(
        z.object({
          pair: pairArg,
          side: sideArg,
          price: priceArg,
          quantity: quantityArg,
          clientOrderId: clientOrderIdArg,
        }),
        raw,
      );
      return ok(await placePaperOrder(app, args));
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_paper_fill", async (raw) => {
    try {
      const args = parseArgs(
        z.object({ orderId: z.string().min(1), price: z.number().positive() }),
        raw,
      );
      const { fee } = app.paper.fill(args.orderId, new Decimal(args.price).toString());
      return ok({ orderId: args.orderId, status: "filled", fee });
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_paper_cancel", async (raw) => {
    try {
      const args = parseArgs(z.object({ orderId: z.string().min(1) }), raw);
      const cancelled = await app.paper.cancel(args.orderId);
      if (!cancelled) throw ValidationError(`paper order ${args.orderId} is not open`);
      return ok({ orderId: args.orderId, status: "cancelled" });
    } catch (error) {
      return fail(error);
    }
  });
}
