import { z } from "zod";
import { ValidationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { DEFAULT_PUBLIC_TOKEN, PUBLIC_WS_URL } from "@indodax-mcp/indodax-websocket";
import { maskPrivateChannel } from "@indodax-mcp/indodax-websocket/private-channel";
import { fail, ok, parseArgs } from "@indodax-mcp/mcp-app/respond";
import { defineTool } from "@indodax-mcp/mcp-app/tools/define";
import type { AppServices } from "@indodax-mcp/mcp-app/composition";

/**
 * Socket lifecycle tools.
 *
 * Separate from the other operational reads because these mutate connection
 * state rather than reporting it, and because the reconnect result is
 * inherently multi-leg: the market and private sockets are independent, so one
 * can succeed while the other fails.
 */

/** Socket lifecycle tools mutate connection state without touching exchange data. */
const SOCKET_MUTATION = {
  capability: "SYSTEM" as const,
  riskClass: "mutation" as const,
  environmentRequirement: "any" as const,
  authRequirement: "none" as const,
  destructive: false,
  idempotencyClass: "none" as const,
  auditClass: "mutation" as const,
};

const wsReconnect = defineTool(
  {
    name: "indodax_ws_reconnect",
    title: "Reconnect sockets",
    description:
      "Mutating connection state. Drop and re-establish market and private sockets. Args: scope " +
      "market, private, or all. Each leg reports independently: connected lists the legs that " +
      "succeeded, reasons names each leg that failed, and partial marks a mixed result. " +
      "reconnected is false when no leg connected. A private leg blocked by missing credentials " +
      "no longer discards a market leg that already reconnected.",
    ...SOCKET_MUTATION,
  },
  { scope: z.enum(["market", "private", "all"]).optional() },
);

const privateConnect = defineTool(
  {
    name: "indodax_private_connect",
    title: "Connect private channel",
    description:
      "Mutating connection state, needs credentials. Fetch a private token and subscribe to the private order-event channel. Returns the channel and connection state, never the token.",
    capability: "READ",
    riskClass: "mutation",
    environmentRequirement: "any",
    authRequirement: "credentials",
    destructive: false,
    idempotencyClass: "none",
    auditClass: "mutation",
  },
  {},
);

const privateDisconnect = defineTool(
  {
    name: "indodax_private_disconnect",
    title: "Disconnect private channel",
    description:
      "Mutating connection state. Drop the private order-event channel without touching credentials or tokens. Use after indodax_private_connect when live mirroring is no longer needed.",
    capability: "READ",
    riskClass: "mutation",
    environmentRequirement: "any",
    authRequirement: "none",
    destructive: false,
    idempotencyClass: "none",
    auditClass: "mutation",
  },
  {},
);

export function registerSocketTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  registry.registerTool(wsReconnect);
  registry.registerTool(privateConnect);
  registry.registerTool(privateDisconnect);

  handlers.tools.set("indodax_ws_reconnect", async (raw) => {
    try {
      const args = parseArgs(wsReconnect.inputSchema, raw);
      const scope = args.scope ?? "all";
      const connected: string[] = [];
      const restored: string[] = [];
      const reasons: string[] = [];
      // A partial result only makes sense against a multi-leg request, so the
      // expected leg count is derived from the requested scope.
      const requestedLegs = scope === "all" ? 2 : 1;
      if (scope === "market" || scope === "all") {
        try {
          const subs = await app.marketSocket.reconnectWithResubscribe({
            url: PUBLIC_WS_URL,
            token: app.env.INDODAX_WS_TOKEN ?? DEFAULT_PUBLIC_TOKEN,
          });
          for (const sub of subs) restored.push(sub.channel);
          connected.push("market");
        } catch (error) {
          reasons.push(`market: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (scope === "private" || scope === "all") {
        try {
          if (!app.privateTokenFetcher) {
            throw ValidationError("private channel needs API credentials");
          }
          app.privateChannel.disconnect();
          await app.privateChannel.connect(app.privateTokenFetcher);
          connected.push("private");
          restored.push(maskPrivateChannel(app.privateChannel.channel) ?? "private");
        } catch (error) {
          // Recorded like the market leg instead of thrown. With scope "all" the
          // market leg may already have reconnected, and a throw here would
          // discard that successful result and report total failure, leaving
          // the caller unable to tell a partial reconnect from a failed one.
          reasons.push(`private: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return ok({
        scope,
        reconnected: connected.length > 0,
        connected,
        restored,
        marketState: app.marketSocket.connectionState,
        note:
          connected.length === 0
            ? `no ${scope} socket connected; reasons carries each failure`
            : restored.length === 0
              ? "connected with no subscriptions to restore; resubscribe first when channel recovery matters"
              : "restored lists resubscribed channels",
        ...(reasons.length > 0
          ? { reasons, partial: connected.length > 0 && connected.length < requestedLegs }
          : {}),
      });
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_private_connect", async () => {
    try {
      if (!app.privateTokenFetcher) {
        throw ValidationError("private channel needs API credentials");
      }
      await app.privateChannel.connect(app.privateTokenFetcher);
      return ok({
        channel: maskPrivateChannel(app.privateChannel.channel),
        state: app.privateChannel.connectionState,
      });
    } catch (error) {
      return fail(error);
    }
  });

  handlers.tools.set("indodax_private_disconnect", async () => {
    app.privateChannel.disconnect();
    return ok({ state: app.privateChannel.connectionState });
  });
}
