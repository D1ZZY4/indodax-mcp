import { z } from "zod";
import {
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  isAppError,
  type AppError,
} from "@d1zzy4-jethools/errors";
import type { Registry } from "@d1zzy4-jethools/mcp-registry";
import type { ServerHandlers } from "@d1zzy4-jethools/mcp-core";
import {
  INDODAX_V2_BASE,
  LegacyTapiSigner,
  nextNonce,
  translateReadError,
} from "@d1zzy4-jethools/indodax-auth";
import { fetchWithRetry } from "@d1zzy4-jethools/transport";
import { egressHint } from "@d1zzy4-jethools/transport/egress";
import { fail, ok, parseArgs } from "@d1zzy4-jethools/mcp-app/respond";
import { defineTool } from "@d1zzy4-jethools/mcp-app/tools/define";
import type { AppServices } from "@d1zzy4-jethools/mcp-app/composition";

const V1_BASE = "https://indodax.com/tapi";
const V2_BASE = INDODAX_V2_BASE;

/**
 * One vocabulary for every funding denial.
 *
 * Four funding tools can fail four different ways for one trade-only key:
 * an empty-but-ok read, a coin-history code, a legacy key-version refusal,
 * and denied-by-design withdrawal. A harness cannot branch on four prose
 * shapes, so every grant-shaped failure below carries the same
 * FUNDING_UNAUTHORIZED reason with the refusing tool named. IP allowlist
 * refusals keep their own richer remedy and are never relabeled.
 */
function fundingUnauthorized(tool: string, detail: string, cause: unknown): AppError {
  const prior = isAppError(cause) ? cause.safeMetadata : undefined;
  const correlationId = isAppError(cause) ? cause.correlationId : undefined;
  return AuthorizationError(
    `FUNDING_UNAUTHORIZED: ${tool} refused (${detail}). next: use an exchange key ` +
      "with a funding grant for funding reads, or treat funding as unavailable for " +
      "this key; market, paper, and trade paths are unaffected",
    {
      ...(correlationId !== undefined ? { correlationId } : {}),
      safeMetadata: {
        ...prior,
        reason: "FUNDING_UNAUTHORIZED",
        haveGrant: false,
        needGrant: "exchange key with funding grant",
        tool,
      },
    },
  );
}

/**
 * Wrap a grant-shaped funding failure, preserving richer errors untouched.
 *
 * IP allowlist refusals already name the egress address and the dashboard
 * action, and parameter mistakes name the right tool, so neither is
 * relabeled: only access-denied-shaped failures without that guidance become
 * FUNDING_UNAUTHORIZED.
 */
function asFundingGrantDenial(tool: string, error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);
  if (/allowlist/i.test(message)) return error;
  if (!/access denied|not authorized|unauthori[sz]ed|forbidden|permission denied/i.test(message)) {
    return error;
  }
  return fundingUnauthorized(tool, message.slice(0, 160), error);
}

/** Crypto-only coin endpoints reject fiat codes at the exchange. Say so first. */
function rejectFiatCoin(tool: string, coin: string | undefined): void {
  if (coin !== undefined && coin.toUpperCase() === "IDR") {
    throw ValidationError(
      `${tool} covers crypto only; for IDR use indodax_fiat_history instead of a coin code`,
      { safeMetadata: { reason: "FIAT_USE_FIAT_HISTORY", coin: coin.toUpperCase(), tool } },
    );
  }
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
    // Thrown raw on purpose: the withdraw_fee handler wraps grant-shaped
    // refusals into FUNDING_UNAUTHORIZED exactly once. Wrapping here as well
    // would nest the same message twice.
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

const READ_AUTH = {
  capability: "READ" as const,
  riskClass: "read" as const,
  environmentRequirement: "any" as const,
  authRequirement: "credentials" as const,
  destructive: false,
  idempotencyClass: "none" as const,
  auditClass: "read" as const,
};

const COIN_SHAPE = { coin: z.string().optional() };

const withdrawHistory = defineTool(
  {
    name: "indodax_withdraw_history",
    title: "Withdraw history",
    description:
      "Read-only, needs credentials. Coin withdrawal history, max 90 days. Args: coin optional.",
    ...READ_AUTH,
  },
  COIN_SHAPE,
);

const depositHistory = defineTool(
  {
    name: "indodax_deposit_history",
    title: "Deposit history",
    description:
      "Read-only, needs credentials. Coin deposit history, max 90 days. Args: coin optional.",
    ...READ_AUTH,
  },
  COIN_SHAPE,
);

const fiatHistory = defineTool(
  {
    name: "indodax_fiat_history",
    title: "Fiat history",
    description: "Read-only, needs credentials. IDR deposit and withdrawal history, max 30 days.",
    ...READ_AUTH,
  },
  {},
);

const depositAddress = defineTool(
  {
    name: "indodax_deposit_address",
    title: "Deposit address",
    description:
      "Read-only, needs credentials. Deposit address for one coin and network; coin and network are uppercased automatically. Returns an empty list with no address when none was generated yet. Args: coin and network required.",
    ...READ_AUTH,
  },
  { coin: z.string().min(1), network: z.string().min(1) },
);

const withdrawFee = defineTool(
  {
    name: "indodax_withdraw_fee",
    title: "Withdraw fee",
    description:
      "Read-only, needs credentials. Quote the withdrawal fee for one currency. A legacy key-version refusal surfaces as FUNDING_UNAUTHORIZED with the refusing tool named. Args: currency required.",
    ...READ_AUTH,
  },
  { currency: z.string().min(1) },
);

export function registerFundingTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool(withdrawHistory);
  registry.registerTool(depositHistory);
  registry.registerTool(fiatHistory);
  registry.registerTool(depositAddress);
  registry.registerTool(withdrawFee);

  handlers.tools.set("indodax_withdraw_history", async (raw) => {
    try {
      const args = parseArgs(withdrawHistory.inputSchema, raw);
      rejectFiatCoin("indodax_withdraw_history", args.coin);
      const params = args.coin ? { coin: args.coin.toUpperCase() } : {};
      const history = (await v2Get(app, "/api/v2/capital/withdraw/history", params)) as unknown[];
      const list = Array.isArray(history) ? history : [];
      return ok({
        coin: args.coin?.toUpperCase() ?? "all",
        count: list.length,
        history: list,
        summary: `${list.length} withdrawal record(s)`,
      });
    } catch (error) {
      return fail(asFundingGrantDenial("indodax_withdraw_history", error));
    }
  });
  handlers.tools.set("indodax_deposit_history", async (raw) => {
    try {
      const args = parseArgs(depositHistory.inputSchema, raw);
      rejectFiatCoin("indodax_deposit_history", args.coin);
      const params = args.coin ? { coin: args.coin.toUpperCase() } : {};
      const history = (await v2Get(app, "/api/v2/capital/deposit/hisrec", params)) as unknown[];
      const list = Array.isArray(history) ? history : [];
      return ok({
        coin: args.coin?.toUpperCase() ?? "all",
        count: list.length,
        history: list,
        summary: `${list.length} deposit record(s)`,
      });
    } catch (error) {
      return fail(asFundingGrantDenial("indodax_deposit_history", error));
    }
  });
  handlers.tools.set("indodax_fiat_history", async () => {
    try {
      const history = (await v2Get(app, "/api/v2/fiat/orders", {})) as { data?: unknown[] };
      const list = Array.isArray(history?.data) ? history.data : [];
      return ok({
        count: list.length,
        history,
        summary: `${list.length} fiat order(s) in the last 30 days`,
      });
    } catch (error) {
      return fail(asFundingGrantDenial("indodax_fiat_history", error));
    }
  });
  handlers.tools.set("indodax_deposit_address", async (raw) => {
    try {
      const args = parseArgs(depositAddress.inputSchema, raw);
      rejectFiatCoin("indodax_deposit_address", args.coin);
      const addresses = (await v2Get(app, "/api/v2/capital/deposit/address/list", {
        coin: args.coin.toUpperCase(),
        network: args.network.toUpperCase(),
      })) as unknown[];
      const list = Array.isArray(addresses) ? addresses : [];
      return ok({
        coin: args.coin.toUpperCase(),
        network: args.network.toUpperCase(),
        count: list.length,
        addresses: list,
        // The read itself succeeded, so listing is permitted. Generation is
        // a separate step the server does not expose: an empty list means no
        // address was generated yet, not a silent permission failure (which
        // would have failed above as FUNDING_UNAUTHORIZED instead).
        permitted: true,
        summary:
          list.length > 0
            ? `${list.length} deposit address(es) for ${args.coin.toUpperCase()} on ${args.network.toUpperCase()}`
            : `no address generated yet for ${args.coin.toUpperCase()} on ${args.network.toUpperCase()}`,
      });
    } catch (error) {
      return fail(asFundingGrantDenial("indodax_deposit_address", error));
    }
  });
  handlers.tools.set("indodax_withdraw_fee", async (raw) => {
    try {
      const args = parseArgs(withdrawFee.inputSchema, raw);
      const fee = await legacyPost(app, "withdrawFee", { currency: args.currency.toLowerCase() });
      return ok({
        currency: args.currency.toLowerCase(),
        fee,
        summary: `withdrawal fee quote for ${args.currency.toLowerCase()}`,
      });
    } catch (error) {
      return fail(asFundingGrantDenial("indodax_withdraw_fee", error));
    }
  });
}
