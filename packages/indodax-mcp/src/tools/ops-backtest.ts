import type { BacktestReport } from "@d1zzy4-jethools/indodax-backtest";

export interface StoredBacktest {
  id: string;
  report: {
    signalsEvaluated: number;
    hypotheticalFills: number;
    totalFees: string;
    netPnl: string;
    maxDrawdownPct: string;
    trades: { index: number; price: string; fee: string }[];
  };
  createdAt: string;
}

const runs = new Map<string, StoredBacktest>();
let runCounter = 1;

/** Bounded so long-running processes cannot leak memory. Oldest run evicted first. */
const MAX_STORED_RUNS = 100;

export function storeBacktest(report: BacktestReport): StoredBacktest {
  const id = `backtest-${runCounter}`;
  runCounter += 1;
  const stored: StoredBacktest = {
    id,
    report: {
      signalsEvaluated: report.signalsEvaluated,
      hypotheticalFills: report.hypotheticalFills,
      totalFees: report.totalFees.toString(),
      netPnl: report.netPnl.toString(),
      maxDrawdownPct: report.maxDrawdownPct.toString(),
      trades: report.trades.map((trade) => ({
        index: trade.index,
        price: trade.price.toString(),
        fee: trade.fee.toString(),
      })),
    },
    createdAt: new Date().toISOString(),
  };
  runs.set(id, stored);
  while (runs.size > MAX_STORED_RUNS) {
    const oldest = runs.keys().next().value;
    if (oldest === undefined) break;
    runs.delete(oldest);
  }
  return stored;
}

export function getBacktest(id: string): StoredBacktest | undefined {
  return runs.get(id);
}
