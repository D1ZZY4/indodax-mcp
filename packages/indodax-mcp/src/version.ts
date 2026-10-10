/**
 * Identity of the MCP server, reported by `indodax_version` and the HTTP
 * gateway health endpoint.
 *
 * The version lives in exactly one place so a release bump cannot leave the
 * tool surface and the gateway health body disagreeing. `version-consistency`
 * asserts this constant against the version in both publishable manifests, so
 * a manifest bump that forgets this file fails a test rather than shipping a
 * server that misreports which release it is.
 */
export const SERVER_NAME = "indodax-mcp";

/**
 * Kept in step with the publishable manifests by test, not by hand.
 *
 * The published package is `indodax-mcp` (apps/mcp-stdio); the companion CLI
 * ships the same version, so both are asserted.
 */
export const SERVER_VERSION = "2.1.0";
