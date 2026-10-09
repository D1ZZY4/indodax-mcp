import Decimal from "decimal.js";
import { asCompact, parseSymbolFlexible } from "@indodax-mcp/core";
import type { AppServices } from "@indodax-mcp/mcp-app/composition";

/**
 * Why a stop could not place, and what would clear it.
 *
 * A take-profit order reserves the quantity it will sell. The exchange
 * accounts balances by reservation, not by ownership, so a cut-loss stop on the
 * same quantity is refused with `-2010 insufficient balance` the moment it
 * triggers. The stop never reached the exchange and the position stayed
 * exposed, which is the worst possible outcome for the tool that exists to
 * limit exactly that loss.
 *
 * Detecting it before placement turns a mid-market emergency into a stated
 * condition: the stop either frees the balance itself, or says precisely what
 * is holding it.
 */

export interface LockedQuantity {
  /** Asset whose balance is reserved, lowercase. */
  asset: string;
  /** Quantity the caller wants to place or sell. */
  required: Decimal;
  /** Quantity the exchange reports as free. */
  free: Decimal;
  /** Orders on the exchange currently reserving this asset. */
  reservations: {
    orderId: string;
    clientOrderId: string | null;
    side: string | null;
    price: string | null;
    quantity: string;
    /** Set when this reservation is the take-profit linked to the stop. */
    linked: boolean;
  }[];
}

export interface LiquidityAssessment {
  /** True when the requested quantity cannot be placed right now. */
  blocked: boolean;
  /** What is holding the balance, empty when nothing blocks. */
  locked: LockedQuantity | null;
  /** The action that clears it. */
  fix: string | null;
}

interface ExchangeOrderRow {
  orderId?: string | number;
  fullOrderId?: string;
  clientOrderId?: string;
  symbol?: string;
  side?: string;
  price?: string;
  origQty?: string;
  executedQty?: string;
  status?: string;
}

function toDecimal(value: unknown): Decimal {
  try {
    const parsed = new Decimal(String(value ?? "0"));
    return parsed.isFinite() ? parsed : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}

/** The exchange spells symbols uppercase compact, for example `HONEYIDR`. */
function symbolMatches(orderSymbol: string | undefined, pair: string): boolean {
  if (orderSymbol === undefined) return false;
  const parsed = parseSymbolFlexible(pair);
  if (!parsed) return false;
  const wanted = new Set([
    asCompact(parsed).toUpperCase(),
    asCompact(parsed),
    `${parsed.base}_${parsed.quote}`.toUpperCase(),
  ]);
  return wanted.has(orderSymbol.toUpperCase());
}

/**
 * A reservation only blocks the side it actually reserves.
 *
 * A SELL order locks the base asset, so it blocks a stop that has to sell that
 * asset. A BUY order locks quote instead, so it does not block a sell stop on a
 * long position: the entry that opened the position must never be blamed for
 * reserving the asset it is meant to be protecting.
 */
function reservesAsset(order: ExchangeOrderRow, side: "BUY" | "SELL"): boolean {
  if (order.side === undefined) return false;
  return order.side.toUpperCase() === side;
}

/** Read the asset a live stop needs free, given its own side. */
export function assetForStop(pair: string, side: "BUY" | "SELL"): string {
  const parsed = parseSymbolFlexible(pair);
  if (!parsed) return "";
  return side === "SELL" ? parsed.base : parsed.quote;
}

/**
 * How much of `pair` is actually placeable right now, and what is holding it.
 *
 * Best effort by design. When the account cannot be read the caller gets
 * `blocked: false` and a null lock, because reporting a block that may not
 * exist would make a working stop look broken. The caller then proceeds and
 * lets the exchange be the authority.
 */
export async function assessLiquidity(
  app: AppServices,
  input: {
    pair: string;
    side: "BUY" | "SELL";
    quantity: Decimal;
    /** Exchange order id this stop is linked to, released before placing. */
    linkedOrderId?: string | undefined;
  },
): Promise<LiquidityAssessment> {
  const asset = assetForStop(input.pair, input.side);
  if (asset === "" || !app.accountClient) return { blocked: false, locked: null, fix: null };

  let account: { balances?: { asset: string; free: string; locked: string }[] };
  let openOrders: unknown;
  try {
    account = await app.accountClient.getAccount();
    app.accountSyncedAt = Date.now();
    openOrders = await app.accountClient.openOrders(input.pair);
  } catch {
    // Unreadable account is unknown, not blocked.
    return { blocked: false, locked: null, fix: null };
  }

  const balance = (account.balances ?? []).find((row) => row.asset.toLowerCase() === asset);
  const free = toDecimal(balance?.free ?? "0");
  if (free.gte(input.quantity)) return { blocked: false, locked: null, fix: null };

  const rows = Array.isArray(openOrders) ? (openOrders as ExchangeOrderRow[]) : [];
  const reservations = rows
    .filter((row) => symbolMatches(row.symbol, input.pair))
    .filter((row) => reservesAsset(row, input.side))
    // A fully executed order has left its reservation behind, so it cannot be
    // what is blocking placement.
    .filter((row) => toDecimal(row.origQty).minus(toDecimal(row.executedQty)).gt(0))
    .map((row) => ({
      orderId: String(row.orderId ?? row.fullOrderId ?? "unknown"),
      clientOrderId: row.clientOrderId ?? null,
      side: row.side ?? null,
      price: row.price ?? null,
      quantity: row.origQty ?? "0",
      linked: input.linkedOrderId !== undefined && String(row.orderId) === input.linkedOrderId,
    }));

  const names = reservations
    .map((row) =>
      row.clientOrderId === null ? `order ${row.orderId}` : `${row.clientOrderId} (${row.orderId})`,
    )
    .join(", ");
  const linked = reservations.some((row) => row.linked);

  return {
    blocked: true,
    locked: { asset, required: input.quantity, free, reservations },
    fix: linked
      ? `the linked take-profit ${names} reserves this quantity; indodax_oco_attach links it so the stop cancels it automatically when it fires`
      : `quantity ${input.quantity.toString()} ${asset} is reserved by ${names || "an open order"}; ` +
        `only ${free.toString()} ${asset} is free. cancel that order first, or attach the stop to it with indodax_oco_attach`,
  };
}

/** Human sentence for a stop_create response that reports a lock. */
export function describeLock(assessment: LiquidityAssessment): string | null {
  if (!assessment.blocked || assessment.locked === null) return null;
  const { asset, required, free, reservations } = assessment.locked;
  const holders = reservations.map((row) => row.clientOrderId ?? `order ${row.orderId}`);
  return (
    `quantity ${required.toString()} ${asset} is not free: only ${free.toString()} is, ` +
    `because ${holders.length > 0 ? holders.join(", ") : "an open order"} reserves it. ` +
    "this stop will be refused with -2010 when it triggers unless that order is cancelled first. " +
    "use indodax_oco_attach to link the stop to the take-profit so it is released automatically"
  );
}
