export type ConnectionState = "CONNECTED" | "DISCONNECTED" | "RECONNECTING" | "RECOVERING" | "LIVE";

export interface WsMessage {
  raw: unknown;
}

export interface ChannelSubscription {
  channel: string;
  lastOffset: number | null;
}

export class SubscriptionRegistry {
  private readonly channels = new Map<string, ChannelSubscription>();

  subscribe(channel: string): void {
    if (!this.channels.has(channel)) this.channels.set(channel, { channel, lastOffset: null });
  }

  unsubscribe(channel: string): boolean {
    return this.channels.delete(channel);
  }

  recordOffset(channel: string, offset: number): void {
    const subscription = this.channels.get(channel);
    if (subscription) {
      subscription.lastOffset =
        subscription.lastOffset === null ? offset : Math.max(subscription.lastOffset, offset);
    }
  }

  list(): ChannelSubscription[] {
    return [...this.channels.values()];
  }
}

export function authMessage(token: string, id = 1): string {
  return JSON.stringify({ params: { token }, id });
}

export function subscribeMessage(channel: string, id = 2, recover?: number): string {
  const params: Record<string, unknown> = { channel };
  if (recover !== undefined) {
    params.recover = true;
    params.offset = recover;
  }
  return JSON.stringify({ method: 1, params, id });
}

export function unsubscribeMessage(channel: string, id = 3): string {
  return JSON.stringify({ method: 2, params: { channel }, id });
}

export function pingMessage(id = 7): string {
  return JSON.stringify({ method: 7, id });
}

/**
 * Private-channel dialect from the official Private WebSocket doc.
 * Shape differs from the market socket: connect carries the token,
 * subscribe carries the private channel, and pushes arrive as
 * { push: { channel, pub: { data: [...] } } }.
 */
export function privateConnectMessage(token: string, id = 1): string {
  return JSON.stringify({ connect: { token }, id });
}

export function privateSubscribeMessage(channel: string, id = 2): string {
  return JSON.stringify({ subscribe: { channel }, id });
}

export function parsePrivatePush(value: unknown): { channel: string; updates: unknown[] } | null {
  if (typeof value !== "object" || value === null) return null;
  const push = (value as Record<string, unknown>).push;
  if (typeof push !== "object" || push === null) return null;
  const inner = push as Record<string, unknown>;
  if (typeof inner.channel !== "string") return null;
  const pub = inner.pub as Record<string, unknown> | undefined;
  const data = pub?.data;
  if (!Array.isArray(data)) return null;
  return { channel: inner.channel, updates: data };
}

export interface ParsedEnvelope {
  channel: string | null;
  offset: number | null;
  data: unknown;
}

export function parseEnvelope(value: unknown): ParsedEnvelope | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const result = record.result;
  if (typeof result !== "object" || result === null) return null;
  const inner = result as Record<string, unknown>;
  const data = inner.data as Record<string, unknown> | undefined;
  const channel = typeof inner.channel === "string" ? inner.channel : null;
  let offset: number | null = null;
  if (data && typeof data === "object") {
    const raw = (data as Record<string, unknown>).offset;
    if (typeof raw === "number") offset = raw;
  }
  return { channel, offset, data: data ?? null };
}

export function isDuplicate(offsets: Set<number>, offset: number): boolean {
  if (offsets.has(offset)) return true;
  offsets.add(offset);
  return false;
}
