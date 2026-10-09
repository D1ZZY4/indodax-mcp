import { describe, expect, it } from "vitest";
import {
  noteConfigured,
  noteStoreConnected,
  noteStoreFailure,
  noteUnconfigured,
  noteWriteOutcome,
  refreshPersistenceState,
} from "@indodax-mcp/mcp-app/persistence-state";

/**
 * Five independent mirrors report into one rollup. A shared success flag let
 * the first successful write clear a failure that belonged to a different
 * store, so a stops mirror that never attached was reported as `connected`
 * with `degraded: false` and an erased error. That is the restart data loss
 * this module exists to make visible.
 */
describe("per-store persistence honesty", () => {
  it("does not let one store's success clear another store's failure", () => {
    noteUnconfigured();
    noteConfigured(["paper", "audit", "alerts", "stops", "deadman"]);
    noteStoreFailure("stops", 'relation "stops" does not exist');
    // The audit mirror works against the same database.
    noteWriteOutcome("audit", true);

    const report = refreshPersistenceState();
    expect(report.state).toBe("failed");
    expect(report.degraded).toBe(true);
    expect(report.lastError).toContain("stops");
    expect(report.stores.stops).toBe("failed");
    expect(report.stores.audit).toBe("connected");
  });

  it("does not promote the rollup while any store is still failing", () => {
    noteUnconfigured();
    noteConfigured(["paper", "audit"]);
    noteStoreConnected("audit");
    noteStoreFailure("paper", "connection refused");
    noteWriteOutcome("audit", true);

    const report = refreshPersistenceState();
    expect(report.state).toBe("failed");
    expect(report.stores.paper).toBe("failed");
  });

  it("recovers when the previously failing store writes successfully", () => {
    noteUnconfigured();
    noteConfigured(["paper", "audit"]);
    noteStoreFailure("stops", "connection refused");
    expect(refreshPersistenceState().state).toBe("failed");

    noteWriteOutcome("stops", true);
    const report = refreshPersistenceState();
    expect(report.state).toBe("connected");
    expect(report.degraded).toBe(false);
    expect(report.lastError).toBeNull();
  });

  it("keeps a failure observed after a success", () => {
    noteUnconfigured();
    noteConfigured(["audit"]);
    noteWriteOutcome("audit", true);
    noteWriteOutcome("audit", false);
    const report = refreshPersistenceState();
    expect(report.state).toBe("failed");
    expect(report.stores.audit).toBe("failed");
  });

  it("clears store state when persistence is unconfigured", () => {
    noteConfigured(["audit"]);
    noteStoreConnected("audit");
    noteUnconfigured();
    expect(refreshPersistenceState().stores).toEqual({});
    expect(refreshPersistenceState().state).toBe("unconfigured");
  });

  it("returns a copy so a caller cannot mutate module state", () => {
    noteConfigured(["audit"]);
    noteStoreConnected("audit");
    const report = refreshPersistenceState();
    report.stores.audit = "failed";
    report.mirrors.push("injected");
    expect(refreshPersistenceState().stores.audit).toBe("connected");
    expect(refreshPersistenceState().mirrors).toEqual(["audit"]);
  });
});
