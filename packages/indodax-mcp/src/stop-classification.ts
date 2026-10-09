/**
 * Classification of a refused stop placement.
 *
 * Retiring a stop removes protection from a position that is still open, so
 * the decision of whether a refusal is terminal has to be stated in one place
 * rather than inferred at each call site. Everything here is pure text
 * analysis over a risk denial or an exchange answer: no market read, no
 * placement, no application state.
 */

/**
 * Reason codes inside a risk denial.
 *
 * The engine joins every failed rule into one comma-separated list after
 * `denied: `, so a stale-context code can appear anywhere in that list. Only
 * the code segment is inspected, because the trailing `next:` remedy text is
 * prose and may mention a rule that did not actually fail.
 */
function denialReasons(reason: string): string[] {
  const denied = /^denied:\s*(.+?)(?:\.\s*next:|$)/.exec(reason);
  const segment = denied?.[1] ?? reason;
  return segment
    .split(",")
    .map((part) => part.trim().split(/\s/)[0] ?? "")
    .filter((code) => code.length > 0);
}

/**
 * Whether a placement refusal can still be cleared by a later cycle.
 *
 * Local context refusals are the ones worth retrying: the price condition
 * already held, the stop never reached the exchange, and the position is
 * still unprotected. Anything the exchange itself refused is terminal,
 * because resubmitting the same order would only be refused again.
 *
 * A refreshable reason keeps the stop armed even when another rule failed in
 * the same evaluation. Retiring it would remove protection from an open
 * position over a condition the next cycle can clear, so every code in the list
 * is searched rather than only the first one.
 */
export function isRetryableStopFailure(reason: string): boolean {
  const codes = new Set(denialReasons(reason));
  return (
    codes.has("STALE_ACCOUNT_STATE") ||
    codes.has("STALE_MARKET_DATA") ||
    codes.has("COOLDOWN_ACTIVE")
  );
}

/**
 * Whether a refusal is a quantity-lock problem rather than a real rejection.
 *
 * The exchange reports the same code for "you do not own this" and "another
 * order is holding it", and the remedy differs completely: one needs funds,
 * the other needs the conflicting order cancelled.
 */
export function isLiquidityBlock(reason: string): boolean {
  return /-2010|insufficient balance|INSUFFICIENT_BALANCE/i.test(reason);
}
