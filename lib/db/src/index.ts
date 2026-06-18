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

// Plain pg Pool. A previous NeonRetryPool subclass overrode connect() as a
// promise-only method, but pg's pool.query() calls connect(callback) internally;
// the ignored callback meant every query hung forever. connectionTimeoutMillis
// gives Neon time to wake from suspension (cold start can take ~20 s); the
// keep-alive ping keeps it warm so that rarely matters.
export const pool = new Pool({
  connectionString,
  connectionTimeoutMillis: 30000,
});

// Prevent unhandled 'error' events on the pool from crashing the process.
// Individual query errors are already caught in route handlers.
pool.on("error", (err) => {
  console.error("[db] pool error:", err.message);
});
export const db = drizzle(pool, { schema });

export * from "./schema";
