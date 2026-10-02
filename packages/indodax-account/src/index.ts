import { z } from "zod";
import { ValidationError } from "@indodax-mcp/errors";
import Decimal from "decimal.js";
import { decimalOrNull } from "@indodax-mcp/core";
import type { FetchFn } from "@indodax-mcp/transport";
import { fetchWithRetry } from "@indodax-mcp/transport";
import type { TapiV2Signer } from "@indodax-mcp/indodax-auth";
import type { Capability } from "@indodax-mcp/core";

export const V2_BASE = "https://api.indodax.com";

const balanceSchema = z.object({
  asset: z.string(),
  free: z.string(),
  locked: z.string(),
});

const accountSchema = z.object({
  canTrade: z.boolean(),
  canWithdraw: z.boolean(),
  accountType: z.string().optional(),
  balances: z.array(balanceSchema),
  uid: z.union([z.string(), z.number()]).optional(),
});

export type AccountInfo = z.infer<typeof accountSchema>;

export interface BalanceView {
  asset: string;
  free: string;
  locked: string;
  total: string;
}

export function toBalanceViews(account: AccountInfo): BalanceView[] {
  return account.balances.map((balance) => {
    const free = decimalOrNull(balance.free) ?? new Decimal("0");
    const locked = decimalOrNull(balance.locked) ?? new Decimal("0");
    return {
      asset: balance.asset.toLowerCase(),
      free: balance.free,
      locked: balance.locked,
      total: free.plus(locked).toString(),
    };
  });
}

export function capabilitiesFor(account: AccountInfo): Capability[] {
  const capabilities: Capability[] = ["READ", "PAPER"];
  if (account.canTrade) capabilities.push("TRADE");
  if (account.canWithdraw) capabilities.push("WITHDRAW");
  return capabilities;
}

export interface AccountClientOptions {
  signer: TapiV2Signer;
  fetchFn?: FetchFn;
  omitZeroBalances?: boolean;
}

export class AccountClient {
  constructor(private readonly options: AccountClientOptions) {}

  async getAccount(): Promise<AccountInfo> {
    const params: Record<string, string> = {};
    if (this.options.omitZeroBalances ?? true) params.omitZeroBalances = "true";
    const query = this.options.signer.buildTimestampParams(params);
    const signature = this.options.signer.signQuery(query);
    const url = `${V2_BASE}/api/v2/account?${query}`;
    const response = await fetchWithRetry(
      url,
      { headers: { "X-APIKEY": this.options.signer.key, Sign: signature } },
      undefined,
      this.options.fetchFn,
    );
    const json: unknown = await response.json();
    const parsed = accountSchema.safeParse(json);
    if (!parsed.success) {
      throw ValidationError("unexpected account shape", {
        safeMetadata: { issues: parsed.error.issues.slice(0, 3) },
      });
    }
    return parsed.data;
  }
}
