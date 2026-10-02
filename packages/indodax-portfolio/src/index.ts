import Decimal from "decimal.js";

export interface HoldingInput {
  asset: string;
  available: Decimal;
  locked: Decimal;
}

export interface EquityResult {
  equity: Decimal;
  positions: number;
}

export function equityIdr(holdings: HoldingInput[], pricesIdr: Map<string, Decimal>): EquityResult {
  let total = new Decimal(0);
  let positions = 0;
  for (const holding of holdings) {
    const amount = holding.available.plus(holding.locked);
    if (amount.isZero()) continue;
    positions += 1;
    if (holding.asset === "idr") {
      total = total.plus(amount);
      continue;
    }
    const price = pricesIdr.get(`${holding.asset}_idr`) ?? pricesIdr.get(holding.asset);
    if (price) total = total.plus(amount.mul(price));
  }
  return { equity: total, positions };
}

export function pnl(current: Decimal, initial: Decimal): Decimal {
  return current.minus(initial);
}

export function drawdownPct(equity: Decimal, peak: Decimal): Decimal {
  if (peak.isZero()) return new Decimal(0);
  return peak.minus(equity).div(peak).mul(100);
}
