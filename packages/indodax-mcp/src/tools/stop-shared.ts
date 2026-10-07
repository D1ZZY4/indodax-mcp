/**
 * Shared metadata for the server-side stop surface.
 *
 * Split out of the stop tool modules so creation and evaluation can live in
 * their own files without a dependency cycle: all three import these
 * constants, and none imports the others for them.
 */

export const STOP = {
  capability: "TRADE" as const,
  riskClass: "mutation" as const,
  environmentRequirement: "paper" as const,
  authRequirement: "none" as const,
  destructive: false,
  idempotencyClass: "client-key" as const,
  auditClass: "mutation" as const,
};

export const STOP_READ = { ...STOP, riskClass: "read" as const, auditClass: "read" as const };
