import { afterAll, beforeAll, describe, expect, it } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { connectDatabase } from "@indodax-mcp/db/client";
import {
  DrizzleAuditRepository,
  DrizzleDeadmanRepository,
  DrizzlePaperLedgerRepository,
} from "@indodax-mcp/db/repositories";
import { tenants } from "@indodax-mcp/db/schema";

const EMBEDDED_PORT = 18899;
const EMBEDDED_URL = `postgresql://postgres:postgres@127.0.0.1:${EMBEDDED_PORT}/postgres`;
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = join(PACKAGE_ROOT, "drizzle");

/**
 * Migrations are plain CREATE TABLE scripts with no IF NOT EXISTS guard and no
 * drop step, because the real migrator tracks applied files in its own journal.
 * Replaying them against a database that already carries the schema therefore
 * fails on the first CREATE.
 *
 * That is invisible on a fresh CI service container and fatal everywhere else:
 * a developer's own DATABASE_URL is populated, so the suite would both fail on
 * every run after the first and write test tables into the database the
 * application actually uses. Isolating the run in its own throwaway database
 * makes the suite repeatable and keeps it off the real one.
 */
function databaseUrlFor(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/**
 * Run every migration file in journal order against an already-open connection.
 *
 * `client.unsafe` is used rather than the drizzle migrator because the test
 * needs the same SQL the application ships, including the `--> statement-
 * breakpoint` separators that the migrator splits on internally.
 */
async function applyMigrations(client: postgres.Sql): Promise<void> {
  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((entry) => entry.endsWith(".sql"))
    .sort();
  for (const migration of migrations) {
    await client.unsafe(readFileSync(join(MIGRATIONS_DIR, migration), "utf8"));
  }
}

/**
 * Delete a database, detaching anything still connected first.
 *
 * DROP DATABASE refuses to run while a session holds a connection, and the
 * pool opened by connectDatabase is exactly such a session. Terminating
 * backends makes teardown independent of test ordering.
 */
async function dropDatabase(admin: postgres.Sql, database: string): Promise<void> {
  await admin.unsafe(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${database}' AND pid <> pg_backend_pid()`,
  );
  await admin.unsafe(`DROP DATABASE IF EXISTS "${database}"`);
}

describe("db on real PostgreSQL", () => {
  let embedded: EmbeddedPostgres | null = null;
  let admin: postgres.Sql | null = null;
  let closeAdmin: () => Promise<void> = async () => {};
  let closeApp: () => Promise<void> = async () => {};
  let activeUrl = "";

  beforeAll(async () => {
    // CI provides an ephemeral Postgres service via DATABASE_URL. Local runs
    // without it fall back to embedded Postgres. Either way the tests below
    // run against a real PostgreSQL instance, never a mock.
    const source = process.env.DATABASE_URL ?? "";
    console.log(
      `db suite using ${source ? "DATABASE_URL service" : "embedded postgres"} in a disposable database`,
    );
    if (source === "") {
      const dataDir = mkdtempSync(join(tmpdir(), "pg-test-"));
      const bunDir = join(PACKAGE_ROOT, "..", "..", "node_modules", ".bun");
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
    } else {
      activeUrl = source;
    }

    // A per-run database, so the migrations start from an empty schema on every
    // run and teardown removes everything this suite created.
    const database = `indodax_db_test_${process.pid}_${Date.now().toString(36)}`;
    const adminClient = postgres(activeUrl, { max: 1 });
    admin = adminClient;
    closeAdmin = () => adminClient.end();
    try {
      await adminClient.unsafe(`CREATE DATABASE "${database}"`);
    } catch (error) {
      await adminClient.end();
      throw new Error(
        `db suite could not create the throwaway database "${database}"; the configured ` +
          `user needs CREATEDB. unset DATABASE_URL to use the embedded instance instead. ` +
          `cause: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    activeUrl = databaseUrlFor(activeUrl, database);
    const { db, close } = connectDatabase(activeUrl);
    closeApp = close;
    try {
      const migrationClient = postgres(activeUrl, { max: 1 });
      await applyMigrations(migrationClient);
      await migrationClient.end();
      await db.insert(tenants).values({ name: "t1" });
    } catch (error) {
      await close();
      await dropDatabase(adminClient, database);
      throw error;
    }
  }, 180_000);

  afterAll(async () => {
    await closeApp();
    if (admin !== null) {
      const parsed = new URL(activeUrl);
      await dropDatabase(admin, parsed.pathname.slice(1));
      await closeAdmin();
    }
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

  it("saves and reloads deadman protection state per tenant", async () => {
    const { db, close: closeDb } = connectDatabase(activeUrl);
    try {
      const repo = new DrizzleDeadmanRepository(db);
      const tenant = await repo.ensureTenant("deadman-tenant");
      expect(await repo.load(tenant)).toBeNull();
      await repo.save(tenant, { state: "ARMED", pairs: ["btc_idr"], countdownMs: 120000 });
      expect(await repo.load(tenant)).toMatchObject({ state: "ARMED", countdownMs: 120000 });
      await repo.save(tenant, { state: "DISARMED", pairs: [], countdownMs: null });
      expect((await repo.load(tenant))?.state).toBe("DISARMED");
    } finally {
      await closeDb();
    }
  });
});
