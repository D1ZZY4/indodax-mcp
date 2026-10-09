import { WebSocketError } from "@d1zzy4-jethools/errors";
import {
  authMessage,
  isDuplicate,
  parseEnvelope,
  parsePrivatePush,
  privateConnectMessage,
  privateSubscribeMessage,
  subscribeMessage,
  type ChannelSubscription,
  type ConnectionState,
} from "@d1zzy4-jethools/indodax-websocket/protocol";
import { extractPrivateUpdates } from "@d1zzy4-jethools/indodax-websocket/private";
import { SubscriptionRegistry } from "@d1zzy4-jethools/indodax-websocket/protocol";

export const PUBLIC_WS_URL = "wss://ws3.indodax.com/ws/";
export const PRIVATE_WS_URL = "wss://pws.indodax.com/ws/?cf_ws_frame_ping_pong=true";
export const DEFAULT_PUBLIC_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE5NDY2MTg0MTV9.UR1lBM6Eqh0yWz-PVirw1uPCxe60FdchR8eNVdsskeo";

export interface StreamEvent {
  channel: string;
  offset: number | null;
  data: unknown;
  duplicate: boolean;
}

export interface SocketOptions {
  url: string;
  token: string;
  timeoutMs?: number;
}

export class ManagedSocket {
  private socket: WebSocket | null = null;
  private state: ConnectionState = "DISCONNECTED";
  private readonly seenOffsets = new Set<number>();
  readonly subscriptions = new SubscriptionRegistry();

  constructor(private readonly onEvent: (event: StreamEvent) => void) {}

  get connectionState(): ConnectionState {
    return this.state;
  }

  listSubscriptions(): ChannelSubscription[] {
    return this.subscriptions.list();
  }

  async connect(options: SocketOptions): Promise<void> {
    this.disconnect();
    this.state = "RECONNECTING";
    const socket = new WebSocket(options.url);
    this.socket = socket;
    await this.awaitOpen(socket, options.timeoutMs ?? 10_000);
    socket.onmessage = (message) => this.handleMessage(String(message.data));
    socket.onclose = () => {
      if (this.socket === socket) {
        this.socket = null;
        this.state = "DISCONNECTED";
      }
    };
    socket.send(authMessage(options.token));
    this.state = "CONNECTED";
    for (const subscription of this.subscriptions.list()) {
      socket.send(subscribeMessage(subscription.channel, 2, subscription.lastOffset ?? undefined));
    }
    if (this.subscriptions.list().length > 0) this.state = "LIVE";
  }

  subscribe(channel: string): void {
    this.subscriptions.subscribe(channel);
    this.socket?.send(subscribeMessage(channel));
    if (this.state === "CONNECTED") this.state = "LIVE";
  }

  /**
   * Private-channel handshake from the official Private WebSocket doc.
   * Separate from the market handshake: connect carries the token and
   * subscribe carries the private channel. No offsets on this channel.
   */
  async connectPrivate(options: SocketOptions & { channel: string }): Promise<void> {
    this.disconnect();
    this.state = "RECONNECTING";
    const socket = new WebSocket(options.url);
    this.socket = socket;
    await this.awaitOpen(socket, options.timeoutMs ?? 10_000);
    socket.onmessage = (message) => this.handleMessage(String(message.data));
    socket.onclose = () => {
      if (this.socket === socket) {
        this.socket = null;
        this.state = "DISCONNECTED";
      }
    };
    socket.send(privateConnectMessage(options.token));
    this.subscriptions.subscribe(options.channel);
    socket.send(privateSubscribeMessage(options.channel));
    this.state = "LIVE";
  }

  subscribePrivate(channel: string): void {
    this.subscriptions.subscribe(channel);
    this.socket?.send(privateSubscribeMessage(channel));
    if (this.state === "CONNECTED") this.state = "LIVE";
  }

  recover(channel: string, offset: number): void {
    this.state = "RECOVERING";
    this.socket?.send(subscribeMessage(channel, 2, offset));
    if (!this.socket) this.state = "DISCONNECTED";
  }

  disconnect(): void {
    try {
      this.socket?.close();
    } catch {
      // already closed
    }
    this.socket = null;
    this.state = "DISCONNECTED";
  }

  /**
   * Wait for the socket handshake. A refused connection resets state to
   * DISCONNECTED instead of sticking at RECONNECTING, and drops the dead
   * socket reference while keeping registry subscriptions intact.
   */
  private async awaitOpen(socket: WebSocket, timeoutMs: number): Promise<void> {
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(WebSocketError("connect timed out")), timeoutMs);
        socket.onopen = () => {
          clearTimeout(timer);
          resolve();
        };
        socket.onerror = () => {
          clearTimeout(timer);
          reject(WebSocketError("connect failed"));
        };
      });
    } catch (error) {
      if (this.socket === socket) {
        this.socket = null;
        this.state = "DISCONNECTED";
      }
      throw error;
    }
  }

  /**
   * Drop the current connection and establish a fresh one. Subscriptions
   * survive in the registry, so connect() re-sends them with offsets.
   * A refused connection propagates, leaving subscriptions intact.
   */
  async reconnectWithResubscribe(options: SocketOptions): Promise<ChannelSubscription[]> {
    this.disconnect();
    await this.connect(options);
    return this.listSubscriptions();
  }

  private handleMessage(text: string): void {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return;
    }
    const push = parsePrivatePush(value);
    if (push) {
      for (const update of extractPrivateUpdates(value)) {
        this.onEvent({ channel: push.channel, offset: null, data: update, duplicate: false });
      }
      return;
    }
    const envelope = parseEnvelope(value);
    if (!envelope?.channel) return;
    const duplicate =
      envelope.offset === null ? false : isDuplicate(this.seenOffsets, envelope.offset);
    if (envelope.offset !== null) {
      this.subscriptions.recordOffset(envelope.channel, envelope.offset);
    }
    this.onEvent({
      channel: envelope.channel,
      offset: envelope.offset,
      data: envelope.data,
      duplicate,
    });
  }
}

export const SUMMARY_CHANNEL = "market:summary-24h";

export function summaryRows(data: unknown): string[][] {
  if (typeof data !== "object" || data === null) return [];
  const inner = (data as Record<string, unknown>).data;
  if (!Array.isArray(inner)) return [];
  return inner.filter((row): row is string[] => Array.isArray(row) && typeof row[0] === "string");
}

export function compactPair(value: string): string {
  return value.trim().toLowerCase().replace(/[-/_]/g, "");
}

export async function oneShotPairSnapshot(
  pair: string,
  token: string = DEFAULT_PUBLIC_TOKEN,
  url: string = PUBLIC_WS_URL,
  timeoutMs = 15_000,
): Promise<StreamEvent> {
  const wanted = compactPair(pair);
  return new Promise<StreamEvent>((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      try {
        socket.close();
      } catch {
        // ignore
      }
      reject(WebSocketError("snapshot timed out"));
    }, timeoutMs);
    let authed = false;
    socket.onopen = () => socket.send(authMessage(token));
    socket.onerror = () => {
      clearTimeout(timer);
      reject(WebSocketError("snapshot failed"));
    };
    socket.onmessage = (message) => {
      let value: unknown;
      try {
        value = JSON.parse(String(message.data));
      } catch {
        return;
      }
      const record = value as Record<string, unknown>;
      if (!authed) {
        if (record.id === 1) {
          authed = true;
          socket.send(subscribeMessage(SUMMARY_CHANNEL));
        }
        return;
      }
      const envelope = parseEnvelope(value);
      const rows = summaryRows(envelope?.data);
      if (envelope?.channel && rows.length > 0) {
        clearTimeout(timer);
        try {
          socket.close();
        } catch {
          // ignore
        }
        const match = rows.find((row) => row[0] === wanted) ?? null;
        resolve({
          channel: envelope.channel,
          offset: envelope.offset,
          data: { pair: wanted, row: match, rows },
          duplicate: false,
        });
      }
    };
  });
}
