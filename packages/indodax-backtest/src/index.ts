import Decimal from "decimal.js";

export interface BacktestTrade {
  index: number;
  price: Decimal;
  fee: Decimal;
}

export interface BacktestReport {
  signalsEvaluated: number;
  hypotheticalFills: number;
  totalFees: Decimal;
  netPnl: Decimal;
  trades: BacktestTrade[];
  maxDrawdownPct: Decimal;
}

export interface BacktestOptions {
  feeRate: Decimal;
  threshold: Decimal;
  notional: Decimal;
}

export function runBacktest(closes: Decimal[], options: BacktestOptions): BacktestReport {
  const trades: BacktestTrade[] = [];
  let totalFees = new Decimal(0);
  let netPnl = new Decimal(0);
  let peak = new Decimal(0);
  let maxDrawdownPct = new Decimal(0);
  for (let index = 1; index < closes.length; index += 1) {
    const previous = closes[index - 1] as Decimal;
    const current = closes[index] as Decimal;
    if (previous.isZero()) continue;
    const change = current.minus(previous).div(previous).abs();
    if (change.gte(options.threshold)) {
      const gross = change.mul(options.notional);
      const fee = gross.mul(options.feeRate);
      totalFees = totalFees.plus(fee);
      netPnl = netPnl.plus(gross.minus(fee));
      if (netPnl.gt(peak)) peak = netPnl;
      const drawdown = peak.isZero() ? new Decimal(0) : peak.minus(netPnl).div(peak).mul(100);
      if (drawdown.gt(maxDrawdownPct)) maxDrawdownPct = drawdown;
      trades.push({ index, price: current, fee });
    }
  }
  return {
    signalsEvaluated: Math.max(0, closes.length - 1),
    hypotheticalFills: trades.length,
    totalFees,
    netPnl,
    trades,
    maxDrawdownPct,
  };
}
