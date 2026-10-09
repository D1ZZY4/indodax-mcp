import { createHmac } from "node:crypto";

export * from "@indodax-mcp/indodax-auth/rejections";

export const INDODAX_V2_BASE = "https://api.indodax.com";

export function hmacSha256Hex(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data, "utf8").digest("hex");
}

export function hmacSha512Hex(data: string, secret: string): string {
  return createHmac("sha512", secret).update(data, "utf8").digest("hex");
}

let lastNonce = 0;

export function nextNonce(nowMs: number = Date.now()): number {
  const next = nowMs > lastNonce ? nowMs : lastNonce + 1;
  lastNonce = next;
  return next;
}

export function resetNonceForTests(): void {
  lastNonce = 0;
}

export function canonicalizeParams(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key] as string)}`)
    .join("&");
}

export class TapiV2Signer {
  constructor(
    private readonly apiKey: string,
    private readonly secret: string,
  ) {}

  get key(): string {
    return this.apiKey;
  }

  signQuery(canonicalQuery: string): string {
    return hmacSha256Hex(canonicalQuery, this.secret);
  }

  buildTimestampParams(extra: Record<string, string>, nowMs: number = Date.now()): string {
    return canonicalizeParams({ ...extra, timestamp: String(nowMs), recvWindow: "5000" });
  }
}

export class LegacyTapiSigner {
  constructor(
    private readonly apiKey: string,
    private readonly secret: string,
  ) {}

  get key(): string {
    return this.apiKey;
  }

  signBody(canonicalBody: string): string {
    return hmacSha512Hex(canonicalBody, this.secret);
  }
}

export class PrivateWebSocketTokenSigner {
  constructor(private readonly secret: string) {}

  signTokenRequest(apiKey: string): { body: string; signature: string } {
    const body = `client=tapi&tapi_key=${encodeURIComponent(apiKey)}`;
    return { body, signature: hmacSha512Hex(body, this.secret) };
  }
}
