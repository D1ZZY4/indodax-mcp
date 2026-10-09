import { z } from "zod";
import { ValidationError } from "@d1zzy4-jethools/errors";
import { PrivateWebSocketTokenSigner } from "@d1zzy4-jethools/indodax-auth";
import { fetchWithRetry, type FetchFn } from "@d1zzy4-jethools/transport";

export const PRIVATE_TOKEN_URL = "https://indodax.com/api/private_ws/v1/generate_token";

const tokenResponseSchema = z.object({
  success: z.number(),
  return: z.object({ connToken: z.string().min(1), channel: z.string().min(1) }).optional(),
  error: z.string().optional(),
});

export interface PrivateTokenResponse {
  token: string;
  channel: string;
}

export async function requestPrivateToken(
  apiKey: string,
  apiSecret: string,
  fetchFn: FetchFn = fetch,
): Promise<PrivateTokenResponse> {
  const signer = new PrivateWebSocketTokenSigner(apiSecret);
  const { body, signature } = signer.signTokenRequest(apiKey);
  const response = await fetchWithRetry(
    PRIVATE_TOKEN_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Sign: signature },
      body,
    },
    undefined,
    fetchFn,
  );
  const json: unknown = await response.json();
  const parsed = tokenResponseSchema.safeParse(json);
  if (!parsed.success || parsed.data.success !== 1 || !parsed.data.return) {
    throw ValidationError("private token request rejected by exchange");
  }
  return { token: parsed.data.return.connToken, channel: parsed.data.return.channel };
}
