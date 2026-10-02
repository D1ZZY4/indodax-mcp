import { WebSocketError } from "@indodax-mcp/errors";
import {
  authMessage,
  isDuplicate,
  parseEnvelope,
  subscribeMessage,
  type ChannelSubscription,
  type ConnectionState,
} from "./protocol.js";
import { SubscriptionRegistry } from "./protocol.js";

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
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(WebSocketError("connect timed out")), 10_000);
      socket.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(WebSocketError("connect failed"));
      };
    });
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

  recover(channel: string, offset: number): void {
    this.state = "RECOVERING";
    this.socket?.send(subscribeMessage(channel, 2, offset));
    this.state = "LIVE";
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

  private handleMessage(text: string): void {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return;
    }
    const envelope = parseEnvelope(value);
    if (!envelope || !envelope.channel) return;
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

export async function oneShotSnapshot(
  channel: string,
  token: string = DEFAULT_PUBLIC_TOKEN,
  url: string = PUBLIC_WS_URL,
  timeoutMs = 10_000,
): Promise<StreamEvent> {
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
          socket.send(subscribeMessage(channel));
        }
        return;
      }
      const envelope = parseEnvelope(value);
      if (envelope?.channel) {
        clearTimeout(timer);
        try {
          socket.close();
        } catch {
          // ignore
        }
        resolve({
          channel: envelope.channel,
          offset: envelope.offset,
          data: envelope.data,
          duplicate: false,
        });
      }
    };
  });
}
