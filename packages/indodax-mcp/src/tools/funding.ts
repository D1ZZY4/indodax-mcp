import { z } from "zod";
import {
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  isAppError,
  type AppError,
} from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import {
  INDODAX_V2_BASE,
  LegacyTapiSigner,
  nextNonce,
  translateReadError,
} from "@indodax-mcp/indodax-auth";
import { fetchWithRetry } from "@indodax-mcp/transport";
import { egressHint } from "@indodax-mcp/transport/egress";
import { fail, ok, parseArgs } from "@indodax-mcp/mcp-app/respond";
import { defineTool } from "@indodax-mcp/mcp-app/tools/define";
import type { AppServices } from "@indodax-mcp/mcp-app/composition";

const V1_BASE = "https://indodax.com/tapi";
const V2_BASE = INDODAX_V2_BASE;

/** The funding read kinds, and which arguments each one needs. */
const KINDS = [
  "withdrawHistory",
  "depositHistory",
  "fiatHistory",
  "depositAddress",
  "withdrawFee",
] as const;

type Kind = (typeof KINDS)[number];

/**
 * One vocabulary for every funding denial.
 *
 * Five funding reads can fail five different ways for one trade-only key:
 * an empty-but-ok read, a coin-history code, a legacy key-version refusal, and
 * denied-by-design withdrawal. A harness cannot branch on five prose shapes, so
 * every grant-shaped failure below carries the same FUNDING_UNAUTHORIZED reason
 * with the kind named. IP allowlist refusals keep their own richer remedy and
 * are never relabelled.
 */
function fundingUnauthorized(kind: string, detail: string, cause: unknown): AppError {
  const prior = isAppError(cause) ? cause.safeMetadata : undefined;
  const correlationId = isAppError(cause) ? cause.correlationId : undefined;
  return AuthorizationError(
    `FUNDING_UNAUTHORIZED: ${kind} refused (${detail}). next: use an exchange key ` +
      "with a funding grant for funding reads, or treat funding as unavailable for " +
      "this key; market, paper, and trade paths are unaffected",
    {
      ...(correlationId !== undefined ? { correlationId } : {}),
      safeMetadata: {
        ...prior,
        reason: "FUNDING_UNAUTHORIZED",
        haveGrant: false,
        needGrant: "exchange key with funding grant",
        tool: kind,
      },
    },
  );
}

/**
 * Wrap a grant-shaped funding failure, preserving richer errors untouched.
 *
 * IP allowlist refusals already name the egress address and the dashboard
 * action, and parameter mistakes name the right tool, so neither is relabelled:
 * only access-denied-shaped failures without that guidance become
 * FUNDING_UNAUTHORIZED.
 */
function asFundingGrantDenial(kind: string, error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);
  if (/allowlist/i.test(message)) return error;
  if (!/access denied|not authorized|unauthori[sz]ed|forbidden|permission denied/i.test(message)) {
    return error;
  }
  return fundingUnauthorized(kind, message.slice(0, 160), error);
}

/** Crypto-only coin endpoints reject fiat codes at the exchange. Say so first. */
function rejectFiatCoin(kind: string, coin: string | undefined): void {
  if (coin !== undefined && coin.toUpperCase() === "IDR") {
    throw ValidationError(
      `${kind} covers crypto only; for IDR read kind fiatHistory instead of a coin code`,
      { safeMetadata: { reason: "FIAT_USE_FIAT_HISTORY", coin: coin.toUpperCase(), tool: kind } },
    );
  }
}

function requireArg(value: string | undefined, name: string, kind: Kind): string {
  if (value === undefined || value === "") {
    throw ValidationError(`kind ${kind} requires ${name}`);
  }
  return value;
}

async function legacyPost(
  app: AppServices,
  method: string,
  params: Record<string, string>,
): Promise<unknown> {
  if (!app.env.INDODAX_API_KEY || !app.env.INDODAX_API_SECRET) {
    throw AuthenticationError("no API credentials configured for this private tool");
  }
  await app.limiter.acquire("v2-rest");
  const signer = new LegacyTapiSigner(app.env.INDODAX_API_KEY, app.env.INDODAX_API_SECRET);
  const body = new URLSearchParams({
    method,
    nonce: String(nextNonce()),
    ...params,
  }).toString();
  const signature = signer.signBody(body);
  const response = await fetchWithRetry(V1_BASE, {
    method: "POST",
    headers: {
      Key: signer.key,
      Sign: signature,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json = (await response.json()) as { success?: number; return?: unknown; error?: string };
  if (json.success !== 1) {
    // Thrown raw on purpose: the handler wraps grant-shaped refusals into
    // FUNDING_UNAUTHORIZED exactly once. Wrapping here as well would nest the
    // same message twice.
    throw ValidationError(`exchange: ${json.error ?? "unknown v1 error"}`);
  }
  return json.return;
}

async function v2Get(
  app: AppServices,
  path: string,
  params: Record<string, string>,
): Promise<unknown> {
  if (!app.signer) throw AuthenticationError("no API credentials configured for this private tool");
  const signer = app.signer;
  await app.limiter.acquire("v2-rest");
  // Sign per attempt. The signature covers a timestamp the exchange validates
  // inside recvWindow, so a single signature reused across a retry burst would
  // expire and turn a transient failure into a permanent rejection.
  try {
    const response = await fetchWithRetry(
      `${V2_BASE}${path}`,
      { method: "GET" },
      undefined,
      undefined,
      () => {
        const query = signer.buildTimestampParams(params);
        return {
          url: `${V2_BASE}${path}?${query}`,
          init: { headers: { "X-APIKEY": signer.key, Sign: signer.signQuery(query) } },
        };
      },
    );
    return response.json();
  } catch (error) {
    const translated = await translateReadError(error, `GET ${path}`, egressHint);
    if (translated !== null) throw translated;
    throw error;
  }
}

const funding = defineTool(
  {
    name: "indodax_funding",
    title: "Funding reads",
    description:
      "Read-only, needs credentials. Authenticated funding information, and nothing else. Absorbs the former indodax_withdraw_history, indodax_deposit_history, indodax_fiat_history, indodax_deposit_address, and indodax_withdraw_fee. Args: kind selects the read. withdrawHistory and depositHistory take an optional crypto coin, default BTC, max 90 days. fiatHistory is the IDR path, max 30 days, and takes no coin. depositAddress requires coin and network. withdrawFee requires currency and is the one legacy compatibility read, signed through TAPI v1 rather than v2. Coin and network are uppercased automatically. Withdrawal itself is never granted; indodax_funding_withdraw still refuses by design.",
    capability: "READ",
    riskClass: "read",
    environmentRequirement: "any",
    authRequirement: "credentials",
    destructive: false,
    idempotencyClass: "none",
    auditClass: "read",
  },
  {
    kind: z.enum(KINDS).describe("Which funding read to perform"),
    coin: z.string().optional().describe("Crypto code for the history kinds"),
    network: z.string().optional().describe("Network for depositAddress"),
    currency: z.string().optional().describe("Currency for withdrawFee"),
  },
);

export function registerFundingTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool(funding);

  handlers.tools.set("indodax_funding", async (raw) => {
    try {
      const args = parseArgs(funding.inputSchema, raw);
      const kind = args.kind;
      if (kind === "fiatHistory") {
        const history = (await v2Get(app, "/api/v2/fiat/orders", {})) as { data?: unknown[] };
        const list = Array.isArray(history?.data) ? history.data : [];
        return ok({
          kind,
          count: list.length,
          history,
          summary: `${list.length} fiat order(s) in the last 30 days`,
        });
      }
      if (kind === "withdrawFee") {
        const currency = requireArg(args.currency, "currency", kind).toLowerCase();
        const fee = await legacyPost(app, "withdrawFee", { currency });
        return ok({
          kind,
          currency,
          fee,
          summary: `withdrawal fee quote for ${currency}`,
        });
      }
      if (kind === "depositAddress") {
        const coin = requireArg(args.coin, "coin", kind).toUpperCase();
        const network = requireArg(args.network, "network", kind).toUpperCase();
        rejectFiatCoin(kind, coin);
        const addresses = (await v2Get(app, "/api/v2/capital/deposit/address/list", {
          coin,
          network,
        })) as unknown[];
        const list = Array.isArray(addresses) ? addresses : [];
        return ok({
          kind,
          coin,
          network,
          count: list.length,
          addresses: list,
          // The read itself succeeded, so listing is permitted. Generation is
          // a separate step the server does not expose: an empty list means no
          // address was generated yet, not a silent permission failure (which
          // would have failed above as FUNDING_UNAUTHORIZED instead).
          permitted: true,
          summary:
            list.length > 0
              ? `${list.length} deposit address(es) for ${coin} on ${network}`
              : `no address generated yet for ${coin} on ${network}`,
        });
      }
      const coin = args.coin?.toUpperCase();
      rejectFiatCoin(kind, coin);
      const path =
        kind === "withdrawHistory"
          ? "/api/v2/capital/withdraw/history"
          : "/api/v2/capital/deposit/hisrec";
      const params = coin === undefined ? {} : { coin };
      const history = (await v2Get(app, path, params)) as unknown[];
      const list = Array.isArray(history) ? history : [];
      const label = kind === "withdrawHistory" ? "withdrawal" : "deposit";
      return ok({
        kind,
        coin: coin ?? "all",
        count: list.length,
        history: list,
        summary: `${list.length} ${label} record(s)`,
      });
    } catch (error) {
      return fail(asFundingGrantDenial(`indodax_funding ${argsKind(raw)}`, error));
    }
  });
}

/**
 * The kind actually sent, read straight from the raw arguments.
 *
 * The grant-denial message has to name the refusing read. The parsed `args`
 * are out of scope in the catch block because a parse failure is exactly one of
 * the failures this path must still be able to label, so the raw value is read
 * again rather than captured from a narrowing that may not have happened.
 */
function argsKind(raw: Record<string, unknown>): string {
  const kind = raw.kind;
  return typeof kind === "string" ? kind : "unknown";
}
