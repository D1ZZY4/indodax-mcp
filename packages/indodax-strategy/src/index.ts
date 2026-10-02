import type { OrderSide } from "@indodax-mcp/core";
import type { SymbolParts } from "@indodax-mcp/core";

export interface StrategyDefinition {
  id: string;
  description: string;
  parameters: Record<string, string>;
}

export const BUILTIN_STRATEGIES: StrategyDefinition[] = [
  {
    id: "ma-cross",
    description: "Price vs moving average crossover signal",
    parameters: { pair: "trading pair", window: "average window" },
  },
  {
    id: "momentum-threshold",
    description: "Absolute-change threshold signal used by backtests",
    parameters: { threshold: "fraction", window: "average window" },
  },
];

export interface Signal {
  symbol: SymbolParts;
  side: OrderSide;
  strength: number;
  reason: string;
}

export interface SignalInput {
  symbol: SymbolParts;
  closes: number[];
  window: number;
}

export function movingAverage(values: number[], window: number): number | null {
  if (window <= 0 || values.length < window) return null;
  const slice = values.slice(values.length - window);
  return slice.reduce((sum, value) => sum + value, 0) / window;
}

export function evaluateMovingAverage(input: SignalInput): Signal | null {
  const average = movingAverage(input.closes, input.window);
  if (average === null || average <= 0) return null;
  const last = input.closes[input.closes.length - 1] as number;
  const drift = (last - average) / average;
  return {
    symbol: input.symbol,
    side: drift >= 0 ? "BUY" : "SELL",
    strength: Math.min(1, Math.abs(drift)),
    reason: `last ${last} vs ma${input.window} ${average}`,
  };
}

export function validateSignalInput(input: SignalInput): string[] {
  const errors: string[] = [];
  if (input.closes.length < 2) errors.push("closes needs at least two numbers");
  if (input.closes.some((price) => !Number.isFinite(price) || price <= 0)) {
    errors.push("closes must hold positive finite prices");
  }
  if (!Number.isInteger(input.window) || input.window < 1 || input.window > input.closes.length) {
    errors.push("window must fit inside closes");
  }
  return errors;
}
