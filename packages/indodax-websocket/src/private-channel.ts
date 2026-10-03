import { TOKEN_TTL_MS, tokenExpired } from "./private.js";
import { PRIVATE_WS_URL, ManagedSocket, type StreamEvent } from "./socket.js";

export interface PrivateToken {
  token: string;
  channel: string;
  issuedAtMs: number;
}

export type TokenFetcher = () => Promise<{ token: string; channel: string }>;
/** Refresh ahead of the 24h expiry so a live socket never authenticates stale. */
export const REFRESH_MARGIN_MS = 60 * 60 * 1000;

export function needsRefresh(
  token: PrivateToken | null,
  nowMs: number,
  marginMs: number = REFRESH_MARGIN_MS,
): boolean {
  if (!token) return true;
  return tokenExpired(nowMs + marginMs, token.issuedAtMs);
}

export function reconnectDelayMs(attempt: number, baseMs = 1_000, maxMs = 30_000): number {
  if (attempt < 0) return baseMs;
  return Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 10));
}

export function tokenAgeMs(token: PrivateToken, nowMs: number): number {
  return Math.max(0, nowMs - token.issuedAtMs);
}

export interface PrivateChannelEvents {
  onEvent: (event: StreamEvent) => void;
  onTokenRefresh?: ((token: PrivateToken) => void) | undefined;
}

/**
 * Dedicated private-channel lifecycle: token fetch, pre-expiry refresh,
 * managed socket connect plus channel subscribe, and bounded exponential
 * reconnect. Token TTL comes from the official 24h private-token contract.
 */
export class PrivateChannelManager {
  private readonly socket: ManagedSocket;
  private token: PrivateToken | null = null;
  private failures = 0;
  private stopped = false;

  constructor(private readonly events: PrivateChannelEvents) {
    this.socket = new ManagedSocket((event) => this.events.onEvent(event));
  }

  get connectionState(): string {
    return this.socket.connectionState;
  }

  get channel(): string | null {
    return this.token?.channel ?? null;
  }

  get consecutiveFailures(): number {
    return this.failures;
  }

  tokenAge(nowMs: number = Date.now()): number | null {
    return this.token ? tokenAgeMs(this.token, nowMs) : null;
  }

  async connect(fetchToken: TokenFetcher, url: string = PRIVATE_WS_URL): Promise<void> {
    this.stopped = false;
    const fetched = await fetchToken();
    this.token = { ...fetched, issuedAtMs: Date.now() };
    this.events.onTokenRefresh?.(this.token);
    await this.socket.connectPrivate({
      url,
      token: this.token.token,
      channel: this.token.channel,
    });
    this.failures = 0;
  }

  async ensureFresh(fetchToken: TokenFetcher, nowMs: number = Date.now()): Promise<boolean> {
    if (!needsRefresh(this.token, nowMs)) return false;
    const fetched = await fetchToken();
    this.token = { ...fetched, issuedAtMs: nowMs };
    this.events.onTokenRefresh?.(this.token);
    return true;
  }

  /** Reconnect attempt with bounded backoff; returns the delay waited. */
  async reconnect(
    fetchToken: TokenFetcher,
    url: string = PRIVATE_WS_URL,
    nowMs: number = Date.now(),
  ): Promise<number> {
    if (this.stopped) return 0;
    const delay = reconnectDelayMs(this.failures);
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (this.stopped) return 0;
    try {
      await this.ensureFresh(fetchToken, nowMs + delay);
      await this.socket.connectPrivate({
        url,
        token: this.requireToken().token,
        channel: this.requireToken().channel,
      });
      this.failures = 0;
    } catch {
      this.failures += 1;
    }
    return delay;
  }

  recordFailure(): void {
    this.failures += 1;
  }

  disconnect(): void {
    this.stopped = true;
    this.socket.disconnect();
  }

  private requireToken(): PrivateToken {
    if (!this.token) throw new Error("private channel has no token; connect first");
    return this.token;
  }
}

export { TOKEN_TTL_MS };
