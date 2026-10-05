import Decimal from "decimal.js";

export type { Decimal };

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
