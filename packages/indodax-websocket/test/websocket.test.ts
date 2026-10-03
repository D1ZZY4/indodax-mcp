import { describe, expect, it } from "vitest";
import {
  SubscriptionRegistry,
  authMessage,
  isDuplicate,
  parseEnvelope,
  pingMessage,
  subscribeMessage,
  unsubscribeMessage,
} from "../src/protocol.js";
import { compactPair, summaryRows, ManagedSocket } from "../src/socket.js";
import { isStpCancellation, parseOrderUpdate, tokenExpired } from "../src/private.js";

describe("websocket protocol", () => {
  it("builds auth, subscribe, and ping frames", () => {
    expect(JSON.parse(authMessage("tok"))).toEqual({ params: { token: "tok" }, id: 1 });
    expect(JSON.parse(subscribeMessage("c", 2, 9)).params).toMatchObject({
      recover: true,
      offset: 9,
    });
    expect(JSON.parse(unsubscribeMessage("c"))).toEqual({
      method: 2,
      params: { channel: "c" },
      id: 3,
    });
    expect(JSON.parse(pingMessage())).toEqual({ method: 7, id: 7 });
  });

  it("parses envelopes and tracks offsets", () => {
    const envelope = parseEnvelope({ result: { channel: "c", data: { data: [], offset: 5 } } });
    expect(envelope?.offset).toBe(5);
    expect(parseEnvelope({ nope: true })).toBeNull();
    const seen = new Set<number>();
    expect(isDuplicate(seen, 5)).toBe(false);
    expect(isDuplicate(seen, 5)).toBe(true);
  });

  it("manages subscription registry", () => {
    const registry = new SubscriptionRegistry();
    registry.subscribe("c");
    registry.recordOffset("c", 4);
    registry.recordOffset("c", 3);
    expect(registry.list()[0]?.lastOffset).toBe(4);
    expect(registry.unsubscribe("c")).toBe(true);
  });
});

describe("private events", () => {
  it("parses fills with fee, tax, and clearing", () => {
    const update = parseOrderUpdate({
      eventType: "order_update",
      order: {
        orderId: "aaveidr-limit-1",
        symbol: "aaveidr",
        side: "BUY",
        origQty: "1",
        unfilledQty: "0",
        executedQty: "1",
        price: "100",
        status: "FILL",
        transactionTime: 1,
        fillInformation: {
          participant: "TAKER",
          filledQty: "1",
          qty: "1",
          feeAsset: "idr",
          feeRate: 0.002,
          fee: "39",
        },
      },
    });
    expect(update.order.status).toBe("FILL");
    expect(isStpCancellation(update)).toBe(false);
  });

  it("detects STP cancellations and token expiry", () => {
    expect(tokenExpired(Date.now(), Date.now() - 25 * 60 * 60 * 1000)).toBe(true);
    expect(tokenExpired(Date.now(), Date.now())).toBe(false);
  });
});

describe("summary snapshot", () => {
  it("compacts pair spellings for row matching", () => {
    expect(compactPair("btc_idr")).toBe("btcidr");
    expect(compactPair("BTC/IDR")).toBe("btcidr");
  });

  it("extracts pair rows from summary envelopes", () => {
    const rows = summaryRows({ data: [["btcidr", 1, 2]], offset: 9 });
    expect(rows).toEqual([["btcidr", 1, 2]]);
    expect(summaryRows({ data: "nope", offset: 1 })).toEqual([]);
    expect(summaryRows(null)).toEqual([]);
  });

  it("keeps RECOVERING until reconnect when socket exists", () => {
    const socket = new ManagedSocket(() => {});
    expect(socket.connectionState).toBe("DISCONNECTED");
    socket.recover("c", 9);
    expect(socket.connectionState).toBe("DISCONNECTED");
  });
});
