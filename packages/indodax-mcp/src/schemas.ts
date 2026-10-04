import { z } from "zod";
import { ValidationError } from "@indodax-mcp/errors";
import { asPair, parseSymbolFlexible } from "@indodax-mcp/core";

/** Shared MCP input schemas. Validation lives here so every tool parses the same way. */

export const pairArg = z.string().min(1).describe("Trading pair, e.g. btc_idr");

export const symbolArg = z.string().min(1).describe("Trading pair symbol, e.g. btcidr");

export const sideArg = z.enum(["BUY", "SELL"]);

export const modeArg = z.enum(["paper", "live", "shadow"]).optional();

export const priceArg = z.number().positive();

export const quantityArg = z.number().positive();

export const clientOrderIdArg = z.string().min(1).max(36).optional();

export const acknowledgedArg = z.boolean().optional();

export const limitArg = (min: number, max: number) => z.number().int().min(min).max(max).optional();

export const toleranceArg = z.string().optional();

/**
 * Canonical pair spelling (`base_quote`, lowercase). Every tool accepts any
 * common spelling on input; stored state, comparisons, and responses use
 * this form so agents never have to guess between btc_idr, BTCIDR, btcidr.
 */
export function canonicalPair(input: string): string {
  const symbol = parseSymbolFlexible(input);
  if (!symbol) throw ValidationError(`invalid pair: ${input}`);
  return asPair(symbol);
}
