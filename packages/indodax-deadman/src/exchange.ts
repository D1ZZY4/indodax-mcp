import { z } from "zod";
import { ValidationError } from "@indodax-mcp/errors";
import { LegacyTapiSigner } from "@indodax-mcp/indodax-auth";
import { fetchWithRetry, type FetchFn } from "@indodax-mcp/transport";

export const DEADMAN_V1_BASE = "https://indodax.com/tapi";

const countdownResponseSchema = z.object({
  success: z.number(),
  error: z.string().optional(),
  error_code: z.string().optional(),
});

export interface DeadmanCountdown {
  pairs: string[];
  countdownMs: number;
}

/**
 * Exchange-side Deadman heartbeat (`POST /tapi countdownCancelAll`).
 * The exchange cancels the given pairs' open orders when no heartbeat
 * arrives within countdownMs. A countdown of 0 stops the exchange timer.
 * Uses the legacy TAPI signing path like the other v1 compatibility calls.
 */
export async function requestDeadmanCountdown(
  apiKey: string,
  apiSecret: string,
  countdown: DeadmanCountdown,
  fetchFn: FetchFn = fetch,
  nowMs: number = Date.now(),
): Promise<void> {
  if (countdown.pairs.length === 0) throw ValidationError("deadman needs at least one pair");
  if (!Number.isFinite(countdown.countdownMs) || countdown.countdownMs < 0) {
    throw ValidationError("countdown must be non-negative milliseconds");
  }
  const signer = new LegacyTapiSigner(apiKey, apiSecret);
  const body = new URLSearchParams({
    pair: countdown.pairs.join(","),
    countdownTime: String(Math.floor(countdown.countdownMs)),
    timestamp: String(nowMs),
    recvWindow: "5000",
  }).toString();
  const signature = signer.signBody(body);
  const response = await fetchWithRetry(
    DEADMAN_V1_BASE,
    {
      method: "POST",
      headers: {
        Key: signer.key,
        Sign: signature,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
    undefined,
    fetchFn,
  );
  const json: unknown = await response.json();
  const parsed = countdownResponseSchema.safeParse(json);
  if (!parsed.success || parsed.data.success !== 1) {
    const reason = parsed.success ? (parsed.data.error ?? "unknown exchange error") : "bad shape";
    throw ValidationError(`exchange deadman rejected: ${reason}`);
  }
}
