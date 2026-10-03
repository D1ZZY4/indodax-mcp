import { z } from "zod";
import { AuthenticationError, ValidationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { INDODAX_V2_BASE, LegacyTapiSigner, nextNonce } from "@indodax-mcp/indodax-auth";
import { fetchWithRetry } from "@indodax-mcp/transport";
import { fail, ok, parseArgs } from "../respond.js";
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
  await app.limiter.acquire("v2-rest");
  const query = app.signer.buildTimestampParams(params);
  const signature = app.signer.signQuery(query);
  const response = await fetchWithRetry(`${V2_BASE}${path}?${query}`, {
    headers: { "X-APIKEY": app.signer.key, Sign: signature },
  });
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

export function registerFundingTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool({
    metadata: {
      name: "indodax_withdraw_history",
      title: "Withdraw history",
      description:
        "Read-only, needs credentials. Coin withdrawal history, max 90 days. Args: coin optional.",
      ...READ_AUTH,
    },
    inputSchema: z.object({ coin: z.string().optional() }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_deposit_history",
      title: "Deposit history",
      description:
        "Read-only, needs credentials. Coin deposit history, max 90 days. Args: coin optional.",
      ...READ_AUTH,
    },
    inputSchema: z.object({ coin: z.string().optional() }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_fiat_history",
      title: "Fiat history",
      description: "Read-only, needs credentials. IDR deposit and withdrawal history, max 30 days.",
      ...READ_AUTH,
    },
    inputSchema: z.object({}),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_deposit_address",
      title: "Deposit address",
      description:
        "Read-only, needs credentials. Deposit address for one coin and network. Args: coin and network required.",
      ...READ_AUTH,
    },
    inputSchema: z.object({ coin: z.string().min(1), network: z.string().min(1) }),
  });
  registry.registerTool({
    metadata: {
      name: "indodax_withdraw_fee",
      title: "Withdraw fee",
      description:
        "Read-only, needs credentials. Quote the withdrawal fee for one currency. Args: currency required.",
      ...READ_AUTH,
    },
    inputSchema: z.object({ currency: z.string().min(1) }),
  });

  handlers.tools.set("indodax_withdraw_history", async (raw) => {
    try {
      const args = parseArgs(z.object({ coin: z.string().optional() }), raw);
      const params = args.coin ? { coin: args.coin.toUpperCase() } : {};
      return ok(await v2Get(app, "/api/v2/capital/withdraw/history", params));
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_deposit_history", async (raw) => {
    try {
      const args = parseArgs(z.object({ coin: z.string().optional() }), raw);
      const params = args.coin ? { coin: args.coin.toUpperCase() } : {};
      return ok(await v2Get(app, "/api/v2/capital/deposit/hisrec", params));
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_fiat_history", async () => {
    try {
      return ok(await v2Get(app, "/api/v2/fiat/orders", {}));
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_deposit_address", async (raw) => {
    try {
      const args = parseArgs(
        z.object({ coin: z.string().min(1), network: z.string().min(1) }),
        raw,
      );
      return ok(
        await v2Get(app, "/api/v2/capital/deposit/address/list", {
          coin: args.coin.toUpperCase(),
          network: args.network.toUpperCase(),
        }),
      );
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_withdraw_fee", async (raw) => {
    try {
      const args = parseArgs(z.object({ currency: z.string().min(1) }), raw);
      return ok(await legacyPost(app, "withdrawFee", { currency: args.currency.toLowerCase() }));
    } catch (error) {
      return fail(error);
    }
  });
}
