import { afterAll, beforeAll, describe, expect, it } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connectDatabase } from "../src/client.js";
import { DrizzleAuditRepository, DrizzlePaperLedgerRepository } from "../src/repositories.js";
import { tenants } from "../src/schema.js";

const EMBEDDED_PORT = 18899;
const EMBEDDED_URL = `postgresql://postgres:postgres@127.0.0.1:${EMBEDDED_PORT}/postgres`;

describe("db on real PostgreSQL", () => {
  let embedded: EmbeddedPostgres | null = null;
  let close: () => Promise<void> = async () => {};
  let activeUrl = "";

  beforeAll(async () => {
    // CI provides an ephemeral Postgres service via DATABASE_URL. Local runs
    // without it fall back to embedded Postgres. Either way the tests below
    // run against a real PostgreSQL instance, never a mock.
    if (process.env.DATABASE_URL) {
      activeUrl = process.env.DATABASE_URL;
    } else {
      const { mkdtempSync } = await import("node:fs");
      const { tmpdir } = await import("node:os");
      const dataDir = mkdtempSync(join(tmpdir(), "pg-test-"));
      const { readdirSync } = await import("node:fs");
      const bunDir = join(process.cwd(), "..", "..", "node_modules", ".bun");
      const nativeEntry = readdirSync(bunDir).find((entry) =>
        entry.startsWith("@embedded-postgres+linux"),
      );
      if (!nativeEntry) throw new Error("embedded postgres native package missing");
      const nativeLib = join(
        bunDir,
        nativeEntry,
        "node_modules",
        "@embedded-postgres",
        "linux-x64",
        "native",
        "lib",
      );
      process.env.LD_LIBRARY_PATH = `${nativeLib}:${process.env.LD_LIBRARY_PATH ?? ""}`;
      const instance = new EmbeddedPostgres({
        databaseDir: dataDir,
        user: "postgres",
        password: "postgres",
        port: EMBEDDED_PORT,
        persistent: false,
      });
      await instance.initialise();
      await instance.start();
      embedded = instance;
      activeUrl = EMBEDDED_URL;
    }
    const { db, close: closeDb } = connectDatabase(activeUrl);
    close = closeDb;
    const { readdirSync: listDir } = await import("node:fs");
    const drizzleDir = join(process.cwd(), "drizzle");
    const migrations = listDir(drizzleDir)
      .filter((entry) => entry.endsWith(".sql"))
      .sort();
    const client = (await import("postgres")).default(activeUrl, { max: 1 });
    for (const migration of migrations) {
      await client.unsafe(readFileSync(join(drizzleDir, migration), "utf8"));
    }
    await client.end();
    await db.insert(tenants).values({ name: "t1" });
  }, 180_000);

  afterAll(async () => {
    await close();
    await embedded?.stop();
  });

  it("appends and traces audit events", async () => {
    const { db, close: closeDb } = connectDatabase(activeUrl);
    try {
      const repo = new DrizzleAuditRepository(db);
      await repo.append({ eventId: "e1", correlationId: "c1", kind: "RiskApproved" });
      expect(await repo.trace("c1")).toHaveLength(1);
      expect(await repo.trace("missing")).toHaveLength(0);
    } finally {
      await closeDb();
    }
  });

  it("saves and reloads paper ledger snapshots per tenant", async () => {
    const { db, close: closeDb } = connectDatabase(activeUrl);
    try {
      const repo = new DrizzlePaperLedgerRepository(db);
      const tenant = await db.insert(tenants).values({ name: "paper-tenant" }).returning();
      const tenantId = tenant[0]?.id as string;
      expect(await repo.load(tenantId)).toBeNull();
      const snapshot = {
        balances: { idr: "99999000" },
        orders: [],
        nextOrderId: 2,
        tradeCount: 1,
        totalFees: "2.6",
        initialBalances: { idr: "100000000" },
      };
      await repo.save(tenantId, snapshot);
      await repo.save(tenantId, { ...snapshot, tradeCount: 2 });
      const loaded = await repo.load(tenantId);
      expect(loaded?.tradeCount).toBe(2);
      expect(loaded?.balances).toEqual({ idr: "99999000" });
    } finally {
      await closeDb();
    }
  });
});
