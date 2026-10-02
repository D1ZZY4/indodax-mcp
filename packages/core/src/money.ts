import Decimal from "decimal.js";

export type { Decimal };

export function toDecimal(value: string | number | Decimal): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

export function decimalOrNull(value: unknown): Decimal | null {
  if (value instanceof Decimal) return value.isFinite() ? value : null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return new Decimal(value);
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

export function decimalOrThrow(value: unknown, label: string): Decimal {
  const parsed = decimalOrNull(value);
  if (parsed === null) throw new Error(`invalid decimal for ${label}`);
  return parsed;
}
