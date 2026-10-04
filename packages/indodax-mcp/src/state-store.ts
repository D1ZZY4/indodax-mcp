import {
  DrizzleDeadmanRepository,
  DrizzleSnapshotRepository,
  alertSnapshots,
  connectDatabase,
  stopSnapshots,
} from "@indodax-mcp/db";
import type { AppServices } from "./composition.js";

/**
 * Durable alerts and stops. In-memory stores stay primary so the server
 * works without a database. When DATABASE_URL is configured, mutations
 * mirror to Postgres and snapshots reload on boot. Failures only log.
 */
function attachSnapshot(
  app: AppServices,
  kind: "alerts" | "stops",
  save: (persist: () => void) => void,
  restore: (stored: unknown[]) => void,
): void {
  const url = app.env.DATABASE_URL;
  if (!url) return;
  void (async () => {
    let repo: DrizzleSnapshotRepository;
    let close: () => Promise<void>;
    try {
      const connection = connectDatabase(url);
      close = connection.close;
      repo = new DrizzleSnapshotRepository(
        connection.db,
        kind === "alerts" ? alertSnapshots : stopSnapshots,
      );
      const stored = await repo.load("local");
      if (stored !== null) {
        try {
          restore(stored);
          app.logger.info(`${kind} restored from database`);
        } catch {
          app.logger.warn(`stored ${kind} snapshot invalid, starting fresh`);
        }
      }
    } catch (error) {
      app.logger.warn(
        { error: String(error), cause: causeOf(error) },
        `${kind} persistence disabled`,
      );
      return;
    }
    app.shutdownHooks.push(async () => {
      await close();
    });
    save(() => {
      const snapshot = kind === "alerts" ? app.alerts.list(true) : app.stops.list(true);
      repo.save("local", snapshot).catch((error: unknown) => {
        app.logger.warn(
          { error: String(error), cause: causeOf(error) },
          `${kind} persistence failed`,
        );
      });
    });
  })();
}

/** Underlying driver cause (e.g. connection refused) without connection secrets. */
function causeOf(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error).slice(0, 200);
  const cause = (error as { cause?: unknown }).cause;
  return String(cause ?? error).slice(0, 200);
}

export function attachAlertPersistence(app: AppServices): void {
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
  );
}

export function attachStopPersistence(app: AppServices): void {
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
  );
}

/**
 * Durable Deadman protection. Without this mirror an armed switch silently
 * disarms on restart; with DATABASE_URL configured the state survives and
 * reloads on boot. Mutations mirror to Postgres; failures only log.
 */
export function attachDeadmanPersistence(app: AppServices): void {
  const url = app.env.DATABASE_URL;
  if (!url) return;
  void (async () => {
    let repo: DrizzleDeadmanRepository;
    let tenantId: string;
    let close: () => Promise<void>;
    try {
      const connection = connectDatabase(url);
      close = connection.close;
      repo = new DrizzleDeadmanRepository(connection.db);
      tenantId = await repo.ensureTenant("local");
      const stored = await repo.load(tenantId);
      if (stored !== null) {
        try {
          app.deadman.restore({
            state: stored.state as "DISARMED" | "ARMED" | "STALE" | "EXPIRED",
            pairs: Array.isArray(stored.pairs) ? stored.pairs.filter(isString) : [],
            countdownMs: stored.countdownMs,
          });
          app.logger.info("deadman restored from database");
        } catch {
          app.logger.warn("stored deadman snapshot invalid, starting disarmed");
        }
      }
    } catch (error) {
      app.logger.warn(
        { error: String(error), cause: causeOf(error) },
        "deadman persistence disabled, keeping memory switch",
      );
      return;
    }
    app.shutdownHooks.push(async () => {
      await close();
    });
    const persist = (): void => {
      const status = app.deadman.snapshot();
      repo
        .save(tenantId, {
          state: status.state,
          pairs: status.pairs,
          countdownMs: status.countdownMs,
        })
        .catch((error: unknown) => {
          app.logger.warn(
            { error: String(error), cause: causeOf(error) },
            "deadman persistence failed, keeping memory switch",
          );
        });
    };
    const deadman = app.deadman;
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
  })();
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
