import {
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
      app.logger.warn({ error: String(error) }, `${kind} persistence disabled`);
      return;
    }
    app.shutdownHooks.push(async () => {
      await close();
    });
    save(() => {
      const snapshot = kind === "alerts" ? app.alerts.list(true) : app.stops.list(true);
      repo.save("local", snapshot).catch((error: unknown) => {
        app.logger.warn({ error: String(error) }, `${kind} persistence failed`);
      });
    });
  })();
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
