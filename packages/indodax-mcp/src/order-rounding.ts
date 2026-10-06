import Decimal from "decimal.js";
import { ValidationError } from "@indodax-mcp/errors";
import { decimalOrNull } from "@indodax-mcp/core";
import type { PairInfo } from "@indodax-mcp/indodax-client";

/**
 * Order rounding.
 *
 * A polling loop had to floor quantities and adjust for the price precision,
 * quantity increment, and per-pair minimum itself, and a small mistake became
 * an exchange rejection. The exchange rejects rather than rounds, so the
 * rounding has to happen before submission.
 *
 * Rounding is only ever downward for quantity and downward for price, so a
 * rounded order can never become larger than what was requested. When the
 * result falls below the pair minimum the call fails with the actual numbers
 * rather than producing an order the exchange will refuse.
 */

export interface RoundedOrder {
  quantity: string;
  quantityOriginal: string;
  price: string | null;
  priceOriginal: string | null;
  /** True when either value changed. */
  adjusted: boolean;
  notes: string[];
}

export interface RoundingContext {
  pair: string;
  quantityIncrement: Decimal | null;
  /** Tick size for the price, when the pair publishes one. */
  priceIncrement: Decimal | null;
  pricePrecision: number | null;
  /**
   * Smallest order size, in the base asset.
   *
   * The pair list names these two fields counter-intuitively, and the names
   * are actively misleading:
   *
   *   `trade_min_base_currency`   is the minimum notional in FIAT. For
   *                               btc_idr it reports 10000, which is
   *                               rupiah, not bitcoin.
   *   `trade_min_traded_currency` is the minimum quantity of the traded asset.
   *                               For btc_idr it reports 6.54e-06, which is a
   *                               plausible minimum BTC size.
   *
   * Reading them the usual way rejects every sane order, so the base currency
   * field is treated as the notional floor and the traded currency field as
   * the quantity floor.
   */
  quantityMin: Decimal | null;
  /** Smallest notional in quote units. */
  tradeMinQuote: Decimal | null;
}

function roundDown(value: Decimal, step: Decimal | null): Decimal {
  if (step === null || step.lte(0)) return value;
  const steps = value.div(step);
  const floored = steps.floor();
  return floored.mul(step);
}

function roundPriceTo(value: Decimal, ctx: RoundingContext): Decimal {
  if (ctx.priceIncrement?.gt(0)) {
    return roundDown(value, ctx.priceIncrement);
  }
  // pricePrecision is a decimal place count. A tick of 10^-precision reproduces
  // the same result without needing a separate increment from the pair.
  if (
    ctx.pricePrecision !== null &&
    Number.isInteger(ctx.pricePrecision) &&
    ctx.pricePrecision >= 0
  ) {
    const step = new Decimal(1).div(new Decimal(10).pow(ctx.pricePrecision));
    return roundDown(value, step);
  }
  return value;
}

export function roundOrder(
  quantity: string,
  price: string | null,
  ctx: RoundingContext,
): RoundedOrder {
  const qty = decimalOrNull(quantity);
  if (qty === null) throw ValidationError(`quantity is not a number: ${quantity}`);
  if (qty.lte(0)) throw ValidationError("quantity must be positive");

  const notes: string[] = [];
  let adjusted = false;

  const finalQty = roundDown(qty, ctx.quantityIncrement);
  if (!finalQty.eq(qty)) {
    adjusted = true;
    notes.push(`quantity ${qty.toString()} rounded down to the ${ctx.pair} increment`);
  }
  if (finalQty.lte(0)) {
    throw ValidationError(
      `quantity ${qty.toString()} is smaller than one ${ctx.pair} increment` +
        (ctx.quantityIncrement === null ? "" : ` of ${ctx.quantityIncrement.toString()}`),
    );
  }
  if (ctx.quantityMin !== null && finalQty.lt(ctx.quantityMin)) {
    throw ValidationError(
      `quantity ${finalQty.toString()} is below the ${ctx.pair} minimum of ` +
        `${ctx.quantityMin.toString()}; the pair requires at least that much`,
    );
  }

  let finalPrice: Decimal | null = null;
  if (price !== null) {
    const px = decimalOrNull(price);
    if (px === null) throw ValidationError(`price is not a number: ${price}`);
    if (px.lte(0)) throw ValidationError("price must be positive");
    finalPrice = roundPriceTo(px, ctx);
    if (!finalPrice.eq(px)) {
      adjusted = true;
      notes.push(`price ${px.toString()} rounded down to the ${ctx.pair} price precision`);
    }
    if (ctx.tradeMinQuote?.gt(0)) {
      const notional = finalQty.mul(finalPrice);
      if (notional.lt(ctx.tradeMinQuote)) {
        throw ValidationError(
          `notional ${notional.toString()} is below the ${ctx.pair} minimum of ` +
            `${ctx.tradeMinQuote.toString()}; raise the quantity or the price`,
        );
      }
    }
  }

  return {
    quantity: finalQty.toString(),
    quantityOriginal: qty.toString(),
    price: finalPrice?.toString() ?? null,
    priceOriginal: price,
    adjusted,
    notes,
  };
}

/** Build the rounding context for a pair from the live pair list. */
export function roundingContextFor(
  pair: string,
  pairs: readonly PairInfo[],
): RoundingContext | null {
  const found = pairs.find((info) => {
    const id = (info.ticker_id ?? "").toLowerCase();
    return id === pair.toLowerCase();
  });
  if (found === undefined) return null;
  return {
    pair,
    quantityIncrement: decimalOrNull(found.quantity_increment),
    priceIncrement: null,
    pricePrecision: found.price_precision === undefined ? null : Number(found.price_precision),
    quantityMin: decimalOrNull(found.trade_min_traded_currency),
    tradeMinQuote: decimalOrNull(found.trade_min_base_currency),
  };
}
