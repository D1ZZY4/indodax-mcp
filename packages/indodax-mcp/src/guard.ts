import { AuthenticationError, AuthorizationError } from "@indodax-mcp/errors";
import type { ToolMetadata } from "@indodax-mcp/mcp-contracts";
import type { AppServices } from "./composition.js";

/**
 * Central metadata gate: enforces the mechanical dimensions (auth and
 * environment) for every tool before its handler runs. Capability,
 * risk-class, and audit-class enforcement stays with handlers and the
 * risk engine, which see full request context.
 */
export function buildGuard(app: AppServices) {
  return (metadata: ToolMetadata, _args: Record<string, unknown>): void => {
    void _args;
    if (metadata.authRequirement === "credentials" && !app.accountClient) {
      throw AuthenticationError("no API credentials configured for this private tool");
    }
    if (metadata.environmentRequirement === "live" && app.env.APP_ENV !== "live") {
      throw AuthorizationError("this tool requires live mode");
    }
  };
}
