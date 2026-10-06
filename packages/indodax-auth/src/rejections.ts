import { ExchangeApiError, isAppError, type AppError } from "@indodax-mcp/errors";
import type { EgressHint } from "@indodax-mcp/transport/egress";

/**
 * Exchange rejection vocabulary, shared by every adapter that talks to the
 * order endpoints.
 *
 * The exchange answers with a numeric code and terse text. A code that names
 * an outcome needs no interpretation from the caller, and the follow-up for
 * each is unambiguous: a missing order means confirm the state, a completed
 * order means do not retry. Leaving that as raw text forces the operator to
 * decide, which is how a cancel gets retried against a filled position.
 *
 * Only codes observed against the live API are listed. An unknown code falls
 * through to the exchange text rather than being guessed at, because a wrong
 * remedy sends a caller down the wrong path.
 */

export interface RejectionOutcome {
  /** Stable machine-readable cause. */
  reason: string;
  /** What the caller should do next. */
  guidance: string;
}

export const ORDER_OUTCOME_REMEDIES: Readonly<Record<number, RejectionOutcome>> = {
  [-2010]: {
    reason: "insufficient_balance",
    guidance:
      "insufficient balance. next: call indodax_balances and compare free funds against " +
      "the amount locked by open orders, then lower the size or free funds before retrying",
  },
  [-2011]: {
    reason: "order_not_found",
    guidance:
      "the exchange does not know this order id, so it is either already filled, already " +
      "cancelled, or the id is wrong; check indodax_order_history before retrying",
  },
  [-2012]: {
    reason: "order_already_completed",
    guidance:
      "the order is filled or cancelled already, so it cannot be cancelled; " +
      "do not retry, read the final state from indodax_order or indodax_order_history",
  },
  [-2013]: {
    reason: "order_not_found",
    guidance:
      "the exchange does not know this order id; confirm it with indodax_order_history " +
      "before assuming the position is still open",
  },
  [-2015]: {
    reason: "ip_not_allowlisted",
    guidance:
      "unauthorized IP address. next: allowlist the egress address named in this message for the " +
      "matching IP family in the exchange dashboard, or use a key without IP restrictions; " +
      "the request signature was accepted, so this is not a credentials or signing problem",
  },
  [-1021]: {
    reason: "client_order_id_reused",
    guidance:
      "invalid client order id. next: generate a fresh clientOrderId, because an id already " +
      "used on the exchange is rejected even when the previous order is gone",
  },
};

export function outcomeFor(code: number | null): RejectionOutcome | undefined {
  return code === null ? undefined : ORDER_OUTCOME_REMEDIES[code];
}

/** Render the actionable suffix appended to an exchange rejection message. */
export function guidanceFor(code: number | null): string {
  return outcomeFor(code)?.guidance ?? "";
}

export interface ExchangePayload {
  code?: number;
  msg?: string;
}

/**
 * Read the exchange error payload out of a transport failure.
 *
 * The exchange signals a business rejection with HTTP 4xx, so the retry
 * helper throws before the adapter sees a body. The payload is recovered from
 * the error metadata instead of the message so the translation sees the real
 * code. Returns null when there is nothing translatable, in which case the
 * caller keeps the original error untouched.
 */
export function parseExchangePayload(error: unknown): ExchangePayload | null {
  if (!isAppError(error)) return null;
  const body = error.safeMetadata?.body;
  if (typeof body !== "string" || body === "") return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null) return parsed as ExchangePayload;
  } catch {
    // A non-JSON body carries no code; the caller keeps the original error.
  }
  return null;
}

export interface TranslatedRejection {
  message: string;
  safeMetadata?: Record<string, unknown> | undefined;
}

/**
 * Render the translated rejection for an already-parsed payload.
 *
 * An IP rejection is unactionable without the address to allowlist, and the
 * family that matters is whichever the exchange actually saw. A dual stack
 * host that only allowlists IPv4 sees this even though IPv4 looks correct.
 */
export function formatRejection(
  action: string,
  raw: ExchangePayload,
  egress: EgressHint | null,
): TranslatedRejection {
  const code = typeof raw.code === "number" ? raw.code : null;
  const text = (raw.msg ?? JSON.stringify(raw)).slice(0, 200);
  const outcome = outcomeFor(code);
  if (outcome !== undefined) {
    const prefix = `exchange rejected ${action}`;
    const note = egress?.note ?? null;
    const egressNote = code === -2015 && note !== null ? ` (${note})` : "";
    const message =
      code === null
        ? `${prefix}: ${outcome.guidance}${egressNote} (${text})`
        : `${prefix} with code ${code}: ${outcome.guidance}${egressNote} (${text})`;
    const safeMetadata: Record<string, unknown> = {
      exchangeCode: code,
      reason: outcome.reason,
    };
    if (code === -2015 && egress !== null) {
      safeMetadata.egressIpv4 = egress.ipv4;
      safeMetadata.egressIpv6 = egress.ipv6;
    }
    return { message, safeMetadata };
  }
  const text2 = JSON.stringify(raw).slice(0, 200);
  if (/insufficient/i.test(text2) && /balance|fund/i.test(text2)) {
    return {
      message:
        `exchange rejected ${action}: insufficient balance (${text2}). ` +
        "next: check indodax_balances for free funds versus amounts locked in open orders, " +
        "then lower the size or free funds before retrying",
    };
  }
  return {
    message:
      `exchange rejected ${action}: ${code === null ? text2 : `code ${code}: ${text2}`}. ` +
      "next: treat this as an exchange rejection; inspect indodax_open_orders and indodax_account " +
      "for state, and do not retry the same request unchanged",
  };
}

/**
 * Translate a transport failure into an actionable rejection, or null when
 * the failure carries nothing translatable.
 *
 * The egress resolver runs only for an IP rejection and never throws: a
 * lookup failure leaves the message otherwise intact.
 */
export async function translateExchangeError(
  error: unknown,
  action: string,
  resolveEgress?: () => Promise<EgressHint>,
): Promise<(TranslatedRejection & { code: number }) | null> {
  const payload = parseExchangePayload(error);
  if (payload === null) return null;
  const code = typeof payload.code === "number" ? payload.code : null;
  let egress: EgressHint | null = null;
  if (code === -2015 && resolveEgress !== undefined) {
    try {
      egress = await resolveEgress();
    } catch {
      egress = null;
    }
  }
  const translated = formatRejection(action, payload, egress);
  return { ...translated, code: code as number };
}

/**
 * Translate a failed authenticated read, preserving its error code.
 *
 * Reads are not orders, so retyping them as OrderRejectedError would mislead
 * anyone branching on the code. The code stays ExchangeApiError while the
 * message gains the exchange code, the reason, and the next action, and the
 * metadata gains the same fields plus the egress addresses on an IP
 * rejection. Returns null when there is nothing translatable, in which case
 * the caller keeps the original error untouched.
 */
export async function translateReadError(
  error: unknown,
  action: string,
  resolveEgress?: () => Promise<EgressHint>,
): Promise<AppError | null> {
  const payload = parseExchangePayload(error);
  if (payload === null) return null;
  const code = typeof payload.code === "number" ? payload.code : null;
  let egress: EgressHint | null = null;
  if (code === -2015 && resolveEgress !== undefined) {
    try {
      egress = await resolveEgress();
    } catch {
      egress = null;
    }
  }
  const translated = formatRejection(action, payload, egress);
  const prior = isAppError(error) ? error.safeMetadata : undefined;
  const correlationId = isAppError(error) ? error.correlationId : undefined;
  return ExchangeApiError(translated.message, {
    ...(correlationId !== undefined ? { correlationId } : {}),
    safeMetadata: { ...prior, ...translated.safeMetadata },
  });
}
