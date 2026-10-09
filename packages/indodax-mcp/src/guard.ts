import { AuthenticationError, AuthorizationError } from "@d1zzy4-jethools/errors";
import type { ToolMetadata } from "@d1zzy4-jethools/mcp-contracts";
import type { AppServices } from "@d1zzy4-jethools/mcp-app/composition";

/**
 * Central metadata gate: enforces the mechanical dimensions (auth and
 * environment) for every tool before its handler runs. Capability,
 * risk-class, and audit-class enforcement stays with handlers and the
 * risk engine, which see full request context.
 */
export function buildGuard(app: AppServices) {
  return (metadata: ToolMetadata, _args: Record<string, unknown>): void => {
    void _args;
    // Environment is checked first. A tool that requires live mode is blocked
    // by the running mode regardless of credentials, and reporting "no
    // credentials" first hides the actual blocker from the operator.
    if (metadata.environmentRequirement === "live" && app.env.APP_ENV !== "live") {
      throw AuthorizationError("this tool requires live mode");
    }
    if (metadata.authRequirement === "credentials" && !app.accountClient) {
      throw AuthenticationError("no API credentials configured for this private tool");
    }
  };
}
