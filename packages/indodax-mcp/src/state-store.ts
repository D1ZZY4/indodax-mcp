import {
  DrizzleDeadmanRepository,
  DrizzleSnapshotRepository,
  alertSnapshots,
  connectDatabase,
  stopSnapshots,
} from "@indodax-mcp/db";
import type { AppServices } from "@indodax-mcp/indodax-mcp/composition";
import { persistenceCause, resolveBootSnapshot } from "@indodax-mcp/indodax-mcp/persist-error";
import {
  noteStoreConnected,
  noteStoreFailure,
  noteWriteOutcome,
} from "@indodax-mcp/indodax-mcp/persistence-state";

/**
 * Recompute health after a mirror settles. Passed in so this module does not
 * depend on the composition root.
 */
export type PersistenceHealth = { refresh: () => void };

/**
 * Durable alerts and stops. In-memory stores stay primary so the server
 * works without a database. When DATABASE_URL is configured, mutations
 * mirror to Postgres and snapshots reload on boot. Failures only log.
 *
 * Boot race: patches install synchronously so boot-time mutations are
 * captured. Restore applies only on a clean boot; mutated memory wins
 * and is mirrored out instead of being overwritten.
 */
function attachSnapshot(
  app: AppServices,
  kind: "alerts" | "stops",
  save: (persist: () => void) => void,
  restore: (stored: unknown[]) => void,
  health: PersistenceHealth,
): void {
  const url = app.env.DATABASE_URL;
  if (!url) return;
  let repo: DrizzleSnapshotRepository | null = null;
  let ready = false;
  let bootDirty = false;
  const snapshotNow = (): unknown =>
    kind === "alerts" ? app.alerts.list(true) : app.stops.list(true);
  const flush = (): void => {
    if (!ready || repo === null) return;
    repo.save("local", snapshotNow()).then(
      () => {
        noteWriteOutcome(kind, true);
      },
      (error: unknown) => {
        noteWriteOutcome(kind, false);
        noteStoreFailure(kind, persistenceCause(error));
        health.refresh();
        app.logger.warn(
          { error: String(error), cause: persistenceCause(error) },
          `${kind} persistence failed`,
        );
      },
    );
  };
  save(() => {
    bootDirty = true;
    flush();
  });
  void (async () => {
    try {
      const connection = connectDatabase(url);
      const close = connection.close;
      const repository = new DrizzleSnapshotRepository(
        connection.db,
        kind === "alerts" ? alertSnapshots : stopSnapshots,
      );
      const stored = await repository.load("local");
      const action = resolveBootSnapshot(stored !== null, bootDirty);
      if (action === "restore" && stored !== null) {
        try {
          restore(stored);
          app.logger.info(`${kind} restored from database`);
        } catch {
          app.logger.warn(`stored ${kind} snapshot invalid, starting fresh`);
        }
      } else if (action === "keep-local") {
        app.logger.info(`${kind} mutated during boot; memory kept and mirrored to database`);
      }
      repo = repository;
      ready = true;
      noteStoreConnected(kind);
      health.refresh();
      app.shutdownHooks.push(async () => {
        await close();
      });
      if (bootDirty) flush();
    } catch (error) {
      noteStoreFailure(kind, persistenceCause(error));
      health.refresh();
      app.logger.warn(
        { error: String(error), cause: persistenceCause(error) },
        `${kind} persistence disabled`,
      );
    }
  })();
}

export function attachAlertPersistence(app: AppServices, health: PersistenceHealth): void {
  attachSnapshot(
    app,
    "alerts",
    (persist) => {
      const store = app.alerts;
      const add = store.add.bind(store);
      store.add = ((alert: Parameters<typeof add>[0]) => {
        const result = add(alert);
        persist();
        return result;
      }) as typeof add;
      const cancel = store.cancel.bind(store);
      store.cancel = (id: string): boolean => {
        const result = cancel(id);
        if (result) persist();
        return result;
      };
      const check = store.check.bind(store);
      store.check = (pair: string, price: number) => {
        const result = check(pair, price);
        if (result.length > 0) persist();
        return result;
      };
    },
    (stored) => app.alerts.restore(stored),
    health,
  );
}

export function attachStopPersistence(app: AppServices, health: PersistenceHealth): void {
  attachSnapshot(
    app,
    "stops",
    (persist) => {
      const store = app.stops;
      const add = store.add.bind(store);
      store.add = ((stop: Parameters<typeof add>[0]) => {
        const result = add(stop);
        persist();
        return result;
      }) as typeof add;
      const cancel = store.cancel.bind(store);
      store.cancel = (id: string): boolean => {
        const result = cancel(id);
        if (result) persist();
        return result;
      };
      const mark = store.mark.bind(store);
      store.mark = (
        id: string,
        status: Parameters<typeof mark>[1],
        extra?: Parameters<typeof mark>[2],
      ): void => {
        mark(id, status, extra);
        persist();
      };
    },
    (stored) => app.stops.restore(stored),
    health,
  );
}

/**
 * Durable Deadman protection. Without this mirror an armed switch silently
 * disarms on restart; with DATABASE_URL configured the state survives and
 * reloads on boot. Mutations mirror to Postgres; failures only log.
 * Boot-time mutations win over the stored snapshot (see attachSnapshot).
 */
export function attachDeadmanPersistence(app: AppServices, health: PersistenceHealth): void {
  const url = app.env.DATABASE_URL;
  if (!url) return;
  const deadman = app.deadman;
  let repo: DrizzleDeadmanRepository | null = null;
  let tenantId = "";
  let ready = false;
  let bootDirty = false;
  const flush = (): void => {
    if (!ready || repo === null) return;
    const status = deadman.snapshot();
    repo
      .save(tenantId, {
        state: status.state,
        pairs: status.pairs,
        countdownMs: status.countdownMs,
      })
      .then(
        () => {
          noteWriteOutcome("deadman", true);
        },
        (error: unknown) => {
          noteWriteOutcome("deadman", false);
          noteStoreFailure("deadman", persistenceCause(error));
          health.refresh();
          app.logger.warn(
            { error: String(error), cause: persistenceCause(error) },
            "deadman persistence failed, keeping memory switch",
          );
        },
      );
  };
  const persist = (): void => {
    bootDirty = true;
    flush();
  };
  const arm = deadman.arm.bind(deadman);
  deadman.arm = (pairs, countdownMs) => {
    const result = arm(pairs, countdownMs);
    persist();
    return result;
  };
  const disarm = deadman.disarm.bind(deadman);
  deadman.disarm = () => {
    const result = disarm();
    persist();
    return result;
  };
  const refreshOk = deadman.recordRefreshSuccess.bind(deadman);
  deadman.recordRefreshSuccess = () => {
    const result = refreshOk();
    persist();
    return result;
  };
  const refreshFail = deadman.recordRefreshFailure.bind(deadman);
  deadman.recordRefreshFailure = () => {
    const result = refreshFail();
    persist();
    return result;
  };
  void (async () => {
    try {
      const connection = connectDatabase(url);
      const close = connection.close;
      const repository = new DrizzleDeadmanRepository(connection.db);
      const tenant = await repository.ensureTenant("local");
      const stored = await repository.load(tenant);
      const action = resolveBootSnapshot(stored !== null, bootDirty);
      if (action === "restore" && stored !== null) {
        try {
          deadman.restore({
            state: stored.state as "DISARMED" | "ARMED" | "STALE" | "EXPIRED",
            pairs: Array.isArray(stored.pairs) ? stored.pairs.filter(isString) : [],
            countdownMs: stored.countdownMs,
          });
          app.logger.info("deadman restored from database");
        } catch {
          app.logger.warn("stored deadman snapshot invalid, starting disarmed");
        }
      } else if (action === "keep-local") {
        app.logger.info("deadman mutated during boot; memory kept and mirrored to database");
      }
      repo = repository;
      tenantId = tenant;
      ready = true;
      noteStoreConnected("deadman");
      health.refresh();
      app.shutdownHooks.push(async () => {
        await close();
      });
      if (bootDirty) flush();
    } catch (error) {
      noteStoreFailure("deadman", persistenceCause(error));
      health.refresh();
      app.logger.warn(
        { error: String(error), cause: persistenceCause(error) },
        "deadman persistence disabled, keeping memory switch",
      );
    }
  })();
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
