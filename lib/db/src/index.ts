import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// APP_DATABASE_URL takes priority over the runtime-managed DATABASE_URL so we
// can point production at a specific Neon endpoint without being blocked by
// Replit's runtime-managed variable restrictions.
const connectionString =
  process.env.APP_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "APP_DATABASE_URL or DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

function isNeonSuspendedError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const msg = (err as Record<string, unknown>).message;
  return (
    typeof msg === "string" &&
    (msg.includes("endpoint has been disabled") ||
      msg.includes("Enable it using the API and retry"))
  );
}

class NeonRetryPool extends Pool {
  override async connect(): Promise<pg.PoolClient> {
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await super.connect();
      } catch (err) {
        if (isNeonSuspendedError(err) && attempt < maxAttempts - 1) {
          const delayMs = Math.min(1000 * 2 ** attempt, 8000);
          await new Promise((res) => setTimeout(res, delayMs));
          continue;
        }
        throw err;
      }
    }
    throw new Error("Failed to connect to database after multiple retries");
  }
}

export const pool = new NeonRetryPool({
  connectionString,
  connectionTimeoutMillis: 10000,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
