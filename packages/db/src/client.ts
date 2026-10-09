import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@d1zzy4-jethools/db/schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export function connectDatabase(url: string): { db: Database; close: () => Promise<void> } {
  const client = postgres(url, { max: 5 });
  const db = drizzle(client, { schema });
  return {
    db,
    close: async () => {
      await client.end();
    },
  };
}

export { schema };
