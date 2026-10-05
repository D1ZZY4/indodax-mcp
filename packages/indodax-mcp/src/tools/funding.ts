import { z } from "zod";
import { AuthenticationError, ValidationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { INDODAX_V2_BASE, LegacyTapiSigner, nextNonce } from "@indodax-mcp/indodax-auth";
import { fetchWithRetry } from "@indodax-mcp/transport";
import { fail, ok, parseArgs } from "../respond.js";
import { defineTool } from "./define.js";
import type { AppServices } from "../composition.js";

const V1_BASE = "https://indodax.com/tapi";
const V2_BASE = INDODAX_V2_BASE;

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
  if (json.success !== 1) throw ValidationError(`exchange: ${json.error ?? "unknown v1 error"}`);
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
  const response = await fetchWithRetry(
    `${V2_BASE}${path}`,
    { headers: { "X-APIKEY": signer.key, Sign: "" } },
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
      "Read-only, needs credentials. Quote the withdrawal fee for one currency. Args: currency required.",
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
      return fail(error);
    }
  });
  handlers.tools.set("indodax_deposit_history", async (raw) => {
    try {
      const args = parseArgs(depositHistory.inputSchema, raw);
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
      return fail(error);
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
      return fail(error);
    }
  });
  handlers.tools.set("indodax_deposit_address", async (raw) => {
    try {
      const args = parseArgs(depositAddress.inputSchema, raw);
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
        summary:
          list.length > 0
            ? `${list.length} deposit address(es) for ${args.coin.toUpperCase()} on ${args.network.toUpperCase()}`
            : `no address generated yet for ${args.coin.toUpperCase()} on ${args.network.toUpperCase()}`,
      });
    } catch (error) {
      return fail(error);
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
      return fail(error);
    }
  });
}
