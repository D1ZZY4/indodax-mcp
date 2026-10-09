import Decimal from "decimal.js";

export type { Decimal };

/**
 * Display rounding for serialized money aggregates.
 *
 * Financial math stays full-precision Decimal until the response boundary;
 * only rendered totals are rounded, so accounting never compounds a display
 * rounding. IDR has no fractional unit and renders with zero places, while
 * cross-asset PnL keeps two.
 */
export function formatMoney(value: Decimal, decimalPlaces: number): string {
  if (!value.isFinite()) return "0";
  return value.toFixed(decimalPlaces);
}

export function decimalOrNull(value: unknown): Decimal | null {
  if (value instanceof Decimal) return value.isFinite() ? value : null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    try {
      const parsed = new Decimal(String(value));
      return parsed.isFinite() ? parsed : null;
    } catch {
      return null;
    }
  }
  if (typeof value === "string" && value.trim() !== "") {
    try {
      const parsed = new Decimal(value);
      return parsed.isFinite() ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}
