import { afterAll, beforeAll, describe, expect, it } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connectDatabase } from "../src/client.js";
import { DrizzleAuditRepository } from "../src/repositories.js";
import { tenants } from "../src/schema.js";

const PORT = 18899;
const URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`;

describe("db on real PostgreSQL", () => {
  let embedded: EmbeddedPostgres;
  let close: () => Promise<void> = async () => {};

  beforeAll(async () => {
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
    embedded = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: "postgres",
      password: "postgres",
      port: PORT,
      persistent: false,
    });
    await embedded.initialise();
    await embedded.start();
    const { db, close: closeDb } = connectDatabase(URL);
    close = closeDb;
    const sql = readFileSync(join(process.cwd(), "drizzle", "0000_mighty_sentinels.sql"), "utf8");
    const client = (await import("postgres")).default(URL, { max: 1 });
    await client.unsafe(sql);
    await client.end();
    await db.insert(tenants).values({ name: "t1" });
  }, 180_000);

  afterAll(async () => {
    await close();
    await embedded.stop();
  });

  it("appends and traces audit events", async () => {
    const { db, close: closeDb } = connectDatabase(URL);
    try {
      const repo = new DrizzleAuditRepository(db);
      await repo.append({ eventId: "e1", correlationId: "c1", kind: "RiskApproved" });
      expect(await repo.trace("c1")).toHaveLength(1);
      expect(await repo.trace("missing")).toHaveLength(0);
    } finally {
      await closeDb();
    }
  });
});
